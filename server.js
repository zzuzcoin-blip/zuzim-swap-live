require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Web3 } = require('web3');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// === SUPABASE ===
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// === WEB3 ===
const web3 = new Web3(process.env.RPC_URL || 'https://eth.llamarpc.com');
const TOKEN_ADDRESS = '0x87D336511760583B11B87866654c6f7253c1cB0D';
const PRESALE_ADDRESS = '0x8CdeBa5Db0a4046D8BBC655244173750c7DFd553';
const STAKING_ADDRESS = '0xa6A074ae51f29665CDF99656D10bE933Ce257dDF';
const TOKEN_PRICE_ETH = 0.0001;

// === ABI ===
const TOKEN_ABI = [{"constant":true,"inputs":[{"name":"owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function"}];
const STAKING_ABI = [
    "function stake(uint256 amount) external",
    "function withdraw(uint256 amount) external",
    "function claimReward() external",
    "function pendingReward(address user) view returns (uint256)",
    "function getStakeInfo(address user) view returns (uint256 amount, uint256 rewardDebt, uint256 lastUpdate, uint256 pending)"
];

// === API ===

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
    const { telegram_id, wallet_address, referrer_id } = req.body;
    const { data: existing } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).maybeSingle();
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

// Получение баланса и стейкинга
app.get('/api/balance/:telegram_id', async (req, res) => {
    const { data: user } = await supabase.from('users').select('balance_zuz, wallet_address').eq('telegram_id', req.params.telegram_id).maybeSingle();
    let staked = 0, rewards = 0;
    if (user?.wallet_address) {
        try {
            const stakingContract = new web3.eth.Contract(STAKING_ABI, STAKING_ADDRESS);
            const info = await stakingContract.methods.getStakeInfo(user.wallet_address).call();
            staked = parseFloat(web3.utils.fromWei(info.amount, 'ether'));
            rewards = parseFloat(web3.utils.fromWei(info.pending, 'ether'));
        } catch(e) { console.log('Staking error:', e.message); }
    }
    res.json({ balance: user?.balance_zuz || 0, staked, rewards });
});

// Покупка за ETH
app.post('/api/buy-eth', async (req, res) => {
    const { telegram_id, eth_amount } = req.body;
    if (!eth_amount || eth_amount < 0.01) return res.status(400).json({ error: 'Минимум 0.01 ETH' });
    const zuz_amount = eth_amount / TOKEN_PRICE_ETH;
    const { data: user } = await supabase.from('users').select('balance_zuz').eq('telegram_id', telegram_id).single();
    const newBalance = (user?.balance_zuz || 0) + zuz_amount;
    await supabase.from('users').update({ balance_zuz: newBalance }).eq('telegram_id', telegram_id);
    
    // Реферальные 5%
    const { data: referrerData } = await supabase.from('users').select('referrer_id').eq('telegram_id', telegram_id).single();
    if (referrerData?.referrer_id) {
        const bonus = zuz_amount * 0.05;
        const { data: referrer } = await supabase.from('users').select('balance_zuz').eq('telegram_id', referrerData.referrer_id).single();
        await supabase.from('users').update({ balance_zuz: (referrer?.balance_zuz || 0) + bonus }).eq('telegram_id', referrerData.referrer_id);
        await supabase.from('referrals').update({ earned_zuz: bonus }).eq('referrer_id', referrerData.referrer_id).eq('referred_id', telegram_id);
    }
    res.json({ success: true, zuz_amount });
});

// Покупка за USDT (заглушка с курсом)
app.post('/api/buy-usdt', async (req, res) => {
    const { telegram_id, usdt_amount } = req.body;
    if (!usdt_amount || usdt_amount < 10) return res.status(400).json({ error: 'Минимум 10 USDT' });
    const eth_usd_rate = 3500; // TODO: заменить на реальный курс
    const eth_amount = usdt_amount / eth_usd_rate;
    const zuz_amount = eth_amount / TOKEN_PRICE_ETH;
    const { data: user } = await supabase.from('users').select('balance_zuz').eq('telegram_id', telegram_id).single();
    await supabase.from('users').update({ balance_zuz: (user?.balance_zuz || 0) + zuz_amount }).eq('telegram_id', telegram_id);
    res.json({ success: true, zuz_amount });
});

// Рефералы
app.get('/api/referrals/:telegram_id', async (req, res) => {
    const { data: referrals } = await supabase.from('referrals').select('referred_id, earned_zuz').eq('referrer_id', req.params.telegram_id);
    const total = (referrals || []).reduce((s, r) => s + (r.earned_zuz || 0), 0);
    res.json({ referrals: referrals || [], count: referrals?.length || 0, total });
});

// Курс (заглушка)
app.get('/api/price', (req, res) => {
    res.json({ eth_usd: 3500, zuz_usd: 3500 * TOKEN_PRICE_ETH });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ ZUZIM Swap API running on port ${PORT}`);
    console.log(`🔒 Staking contract: ${STAKING_ADDRESS}`);
});
