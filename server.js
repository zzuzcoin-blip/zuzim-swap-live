require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Web3 } = require('web3');  // <-- ИСПРАВЛЕНО: деструктуризация для версий 4.x

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// === ПОДКЛЮЧЕНИЕ К SUPABASE ===
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// === WEB3 НАСТРОЙКИ ===
const web3 = new Web3(process.env.RPC_URL || 'https://eth.llamarpc.com');
const PRESALE_ADDRESS = '0x8CdeBa5Db0a4046D8BBC655244173750c7DFd553';
const TOKEN_ADDRESS = '0x87D336511760583B11B87866654c6f7253c1cB0D';
const TOKEN_PRICE_ETH = 0.0001;

// === API ===

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
    const { telegram_id, wallet_address, referrer_id } = req.body;
    
    const { data: existing, error: findError } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegram_id)
        .maybeSingle();
    
    if (findError) return res.status(500).json({ error: findError.message });
    
    if (!existing) {
        await supabase.from('users').insert([{ telegram_id, wallet_address, referrer_id }]);
        if (referrer_id) {
            await supabase.from('referrals').insert([{ referrer_id, referred_id: telegram_id }]);
        }
    } else if (wallet_address && existing.wallet_address !== wallet_address) {
        await supabase.from('users').update({ wallet_address }).eq('telegram_id', telegram_id);
    }
    
    res.json({ success: true });
});

// Получение баланса
app.get('/api/balance/:telegram_id', async (req, res) => {
    const { data: user, error } = await supabase
        .from('users')
        .select('balance_zuz')
        .eq('telegram_id', req.params.telegram_id)
        .maybeSingle();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ balance: user?.balance_zuz || 0 });
});

// Покупка за ETH
app.post('/api/buy-eth', async (req, res) => {
    const { telegram_id, eth_amount, tx_hash } = req.body;
    if (!eth_amount || eth_amount < 0.01) {
        return res.status(400).json({ error: 'Минимум 0.01 ETH' });
    }
    
    const zuz_amount = eth_amount / TOKEN_PRICE_ETH;
    
    const { data: user } = await supabase
        .from('users')
        .select('balance_zuz')
        .eq('telegram_id', telegram_id)
        .single();
    
    const newBalance = (user?.balance_zuz || 0) + zuz_amount;
    await supabase.from('users').update({ balance_zuz: newBalance }).eq('telegram_id', telegram_id);
    
    // Реферальные 5%
    const { data: referrerData } = await supabase
        .from('users')
        .select('referrer_id')
        .eq('telegram_id', telegram_id)
        .single();
    
    if (referrerData?.referrer_id) {
        const bonus = zuz_amount * 0.05;
        const { data: referrer } = await supabase
            .from('users')
            .select('balance_zuz')
            .eq('telegram_id', referrerData.referrer_id)
            .single();
        const newReferrerBalance = (referrer?.balance_zuz || 0) + bonus;
        await supabase.from('users').update({ balance_zuz: newReferrerBalance }).eq('telegram_id', referrerData.referrer_id);
        await supabase.from('referrals').update({ earned_zuz: bonus }).eq('referrer_id', referrerData.referrer_id).eq('referred_id', telegram_id);
    }
    
    res.json({ success: true, zuz_amount });
});

app.post('/api/buy-usdt', async (req, res) => {
    const { telegram_id, usdt_amount, tx_hash } = req.body;
    if (!usdt_amount || usdt_amount < 10) {
        return res.status(400).json({ error: 'Минимум 10 USDT' });
    }
    
    const eth_usd_rate = 3500; // TODO: заменить на реальный курс
    const eth_amount = usdt_amount / eth_usd_rate;
    const zuz_amount = eth_amount / TOKEN_PRICE_ETH;
    
    const { data: user } = await supabase
        .from('users')
        .select('balance_zuz')
        .eq('telegram_id', telegram_id)
        .single();
    
    const newBalance = (user?.balance_zuz || 0) + zuz_amount;
    await supabase.from('users').update({ balance_zuz: newBalance }).eq('telegram_id', telegram_id);
    
    res.json({ success: true, zuz_amount });
});

app.get('/api/referrals/:telegram_id', async (req, res) => {
    const { data: referrals, error } = await supabase
        .from('referrals')
        .select('referred_id, earned_zuz')
        .eq('referrer_id', req.params.telegram_id);
    
    if (error) return res.status(500).json({ error: error.message });
    
    const total = referrals.reduce((sum, r) => sum + (r.earned_zuz || 0), 0);
    res.json({ referrals, count: referrals.length, total });
});

app.get('/api/price', (req, res) => {
    res.json({ eth_usd: 3500, zuz_usd: 3500 * TOKEN_PRICE_ETH });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ ZUZIM Swap API running on port ${PORT}`);
});
