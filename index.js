const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// ================== متغيرات البيئة ==================
const TOKEN = process.env.DISCORD_BOT_TOKEN; 
const CHECKER_TOKEN = process.env.DISCORD_USER_TOKEN; 
const CHANNEL_ID = process.env.CHANNEL_ID; 

// التحقق من وجود المتغيرات
if (!TOKEN || !CHECKER_TOKEN || !CHANNEL_ID) {
    console.error('❌ Missing environment variables!');
    process.exit(1);
}
// ==================================================

// ================== Keep Alive for Render ==================
const app = express();
const PORT = process.env.PORT || 3000; // Render يحدد PORT تلقائياً

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Discord Bot</title>
                <meta http-equiv="refresh" content="60">
                <style>
                    body { background: #0a0a0a; color: #00ff88; font-family: Arial; text-align: center; padding: 50px; }
                    h1 { font-size: 3em; margin-bottom: 20px; }
                    .stats { font-size: 1.5em; line-height: 2; }
                    .online { color: #00ff00; }
                    .offline { color: #ff0000; }
                </style>
            </head>
            <body>
                <h1>🚀 بوت ديسكورد - شغال على Render</h1>
                <div class="stats">
                    <p>📊 تم الفحص: <span id="checked">0</span></p>
                    <p>✅ تم العثور: <span id="found">0</span></p>
                    <p>⚡ السرعة: <span id="speed">0</span> اسم/ثانية</p>
                    <p>🟢 الحالة: <span class="online" id="status">شغال</span></p>
                </div>
                <script>
                    setInterval(() => {
                        fetch('/stats')
                            .then(r => r.json())
                            .then(d => {
                                document.getElementById('checked').innerText = d.checked;
                                document.getElementById('found').innerText = d.found;
                                document.getElementById('speed').innerText = d.speed;
                                document.getElementById('status').innerText = d.active ? 'شغال' : 'متوقف';
                                document.getElementById('status').className = d.active ? 'online' : 'offline';
                            })
                            .catch(() => {});
                    }, 5000);
                </script>
            </body>
        </html>
    `);
});

app.get('/stats', (req, res) => {
    res.json({
        checked: stats.checked || 0,
        found: stats.found || 0,
        speed: stats.speed || 0,
        active: generationActive || false
    });
});

app.listen(PORT, () => {
    console.log(`✅ Web server running on port ${PORT}`);
});
// =======================================================

// ================== إعدادات البوت ==================
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// ⚡ إعدادات السرعة
const BATCH_SIZE = 2;           // طلبين مع بعض
const BASE_DELAY = 200;          // 0.2 ثانية (آمن لـ Render)
const JITTER = 50;               // تذبذب عشوائي
// ==================================================

let generationActive = false;
let stats = { checked: 0, found: 0, startTime: null, speed: 0 };

// مجلد النتائج
if (!fs.existsSync('./results')) fs.mkdirSync('./results');

// ================== قائمة الأوامر ==================
const COMMANDS = {
    START: ['start', 'شغل', 'انطلق', 'بدء'],
    STOP: ['stop', 'قف', 'ايقاف', 'وقف'],
    STATS: ['stats', 'احصائيات', 'إحصائيات'],
    RESULTS: ['results', 'نتائج'],
    HELP: ['help', 'مساعدة', 'اوامر']
};

// ================== عميل HTTP ==================
const http = axios.create({
    baseURL: 'https://discord.com/api/v9',
    headers: { 
        'Authorization': CHECKER_TOKEN, 
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)'
    },
    timeout: 5000
});

// ================== توليد الأسماء ==================
function* usernameGenerator() {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const rareLetters = 'xyzqwk';
    
    // أنماط نادرة
    for (let l of rareLetters) {
        for (let d of digits) {
            yield l + l + l + d;
            yield l + l + d + l;
            yield l + d + l + l;
            yield d + l + l + l;
        }
    }
    
    // أنماط متكررة
    for (let l1 of letters) {
        for (let l2 of letters) {
            if (l1 !== l2) {
                yield l1 + l1 + l2 + l2;
                yield l1 + l2 + l1 + l2;
            }
        }
    }
    
    // كل الاحتمالات
    for (let a of letters) {
        for (let b of letters) {
            for (let c of letters) {
                for (let d of digits) {
                    yield a + b + c + d;
                }
            }
        }
    }
}

// ================== محرك البحث ==================
async function startEngine(message) {
    const gen = usernameGenerator();
    stats.startTime = Date.now();
    
    const statusMsg = await message.reply("🚀 **محرك البحث انطلق!** ⚡");
    
    let batch = [];
    let foundBatch = [];
    
    // مراقب السرعة
    let speedInterval = setInterval(() => {
        if (stats.startTime && stats.checked > 0) {
            const elapsed = (Date.now() - stats.startTime) / 1000;
            stats.speed = (stats.checked / elapsed).toFixed(1);
        }
    }, 5000);
    
    while (generationActive) {
        const { value: username, done } = gen.next();
        if (done) break;
        
        batch.push(username);
        
        if (batch.length >= BATCH_SIZE) {
            const delay = BASE_DELAY + Math.random() * JITTER;
            
            const promises = batch.map(u => 
                http.post('/users/@me/username-attempt', { username: u })
                .then(r => ({ name: u, available: !r.data.taken }))
                .catch(e => ({ 
                    name: u, 
                    available: false, 
                    error: e.response?.status,
                    retry: e.response?.data?.retry_after 
                }))
            );
            
            const results = await Promise.all(promises);
            
            for (const res of results) {
                stats.checked++;
                
                if (res.available) {
                    stats.found++;
                    foundBatch.push(res.name);
                    
                    // حفظ مع الوقت
                    const timeStr = new Date().toLocaleString('ar-EG');
                    fs.appendFileSync('./results/available.txt', `${res.name} - ${timeStr}\n`);
                }
                
                if (res.error === 401) {
                    generationActive = false;
                    clearInterval(speedInterval);
                    return message.reply("❌ **التوكن مات!** غير التوكن ورجع شغلني");
                }
                
                if (res.error === 429) {
                    const waitTime = (res.retry || 2) * 1000;
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }
            
            // إرسال الأسماء المتاحة
            if (foundBatch.length >= 3) {
                message.channel.send(`⚡ **${foundBatch.join('**, **')}** ✅`);
                foundBatch = [];
            }
            
            // تحديث الحالة
            if (stats.checked % 50 === 0) {
                statusMsg.edit(`🚀 **السرعة:** ${stats.speed} اسم/ثانية\n📊 **فحص:** ${stats.checked}\n✅ **وجد:** ${stats.found}`);
            }
            
            batch = [];
            await new Promise(r => setTimeout(r, delay));
        }
    }
    
    clearInterval(speedInterval);
    
    if (foundBatch.length > 0) {
        message.channel.send(`⚡ **${foundBatch.join('**, **')}** ✅`);
    }
    
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    message.channel.send(`🏁 **انتهى البحث!**\n⚡ سرعة: ${stats.speed} اسم/ثانية\n📊 فحص: ${stats.checked}\n✅ وجد: ${stats.found}`);
}

// ================== معالج الأوامر ==================
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;
    if (!message.content.startsWith('!')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    
    if (COMMANDS.START.includes(cmd)) {
        if (generationActive) {
            return message.reply("⚡ المحرك شغال بالفعل! استخدم `!قف` أو `!stop`");
        }
        generationActive = true;
        stats = { checked: 0, found: 0, startTime: null, speed: 0 };
        startEngine(message);
    }
    
    else if (COMMANDS.STOP.includes(cmd)) {
        generationActive = false;
        message.reply("🛑 **تم إيقاف المحرك**");
    }
    
    else if (COMMANDS.STATS.includes(cmd)) {
        const elapsed = stats.startTime ? ((Date.now() - stats.startTime) / 1000).toFixed(1) : 0;
        
        const embed = new EmbedBuilder()
            .setTitle('📊 الإحصائيات | Statistics')
            .setColor(0x00ff00)
            .addFields(
                { name: '⚡ السرعة', value: `${stats.speed} اسم/ثانية`, inline: true },
                { name: '📊 تم الفحص', value: stats.checked.toString(), inline: true },
                { name: '✅ تم العثور', value: stats.found.toString(), inline: true },
                { name: '⏱️ الوقت', value: `${elapsed} ثانية`, inline: true },
                { name: '🎯 نسبة النجاح', value: stats.checked ? `${((stats.found/stats.checked)*100).toFixed(3)}%` : '0%', inline: true },
                { name: '🟢 الحالة', value: generationActive ? 'شغال' : 'متوقف', inline: true }
            );
        
        message.channel.send({ embeds: [embed] });
    }
    
    else if (COMMANDS.RESULTS.includes(cmd)) {
        if (fs.existsSync('./results/available.txt')) {
            const data = fs.readFileSync('./results/available.txt', 'utf8').split('\n').filter(Boolean);
            
            if (data.length === 0) {
                return message.reply("📭 لا توجد نتائج بعد");
            }
            
            let response = `📁 **النتائج:** ${data.length} اسم\n`;
            response += `📋 آخر 5: ${data.slice(-5).join(' | ')}`;
            
            message.channel.send(response);
            message.channel.send({ files: ['./results/available.txt'] });
        } else {
            message.reply("📭 لا توجد نتائج بعد");
        }
    }
    
    else if (COMMANDS.HELP.includes(cmd)) {
        const embed = new EmbedBuilder()
            .setTitle('⚡ أوامر البوت | Bot Commands')
            .setDescription('**عربي / English**')
            .setColor(0xff5500)
            .addFields(
                { name: '🚀 التشغيل', value: '`!start`, `!شغل`, `!انطلق`', inline: false },
                { name: '🛑 الإيقاف', value: '`!stop`, `!قف`, `!ايقاف`', inline: false },
                { name: '📊 الإحصائيات', value: '`!stats`, `!احصائيات`', inline: false },
                { name: '📁 النتائج', value: '`!results`, `!نتائج`', inline: false },
                { name: '❓ المساعدة', value: '`!help`, `!مساعدة`', inline: false }
            )
            .setFooter({ text: '🚀 يعمل على Render 24/7' });
        
        message.channel.send({ embeds: [embed] });
    }
});

client.on('ready', () => {
    console.log(`✅ البوت جاهز: ${client.user.tag}`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (channel) {
        channel.send("⚡ **البوت جاهز على Render!**\nأوامر عربي وإنجليزي: `!help` / `!مساعدة`");
    }
});

// ================== تشغيل البوت ==================
client.login(TOKEN).catch(err => {
    console.error('❌ فشل تسجيل الدخول:', err.message);
    process.exit(1);
});
