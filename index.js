const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// ================== الإعدادات ==================
const TOKEN = process.env.DISCORD_BOT_TOKEN; 
const CHECKER_TOKEN = process.env.DISCORD_USER_TOKEN; 
const CHANNEL_ID = process.env.CHANNEL_ID; 

// ⚡ إعدادات السرعة الذكية
const BATCH_SIZE = 2;           // طلبين مع بعض (آمن)
const BASE_DELAY = 150;          // 0.15 ثانية
const JITTER = 50;               // تذبذب عشوائي
// ===============================================

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

let generationActive = false;
let stats = { checked: 0, found: 0, startTime: null, speed: 0 };

// مجلد النتائج
if (!fs.existsSync('./results')) fs.mkdirSync('./results');

// ================== قائمة الأوامر (عربي + إنجليزي) ==================
const COMMANDS = {
    // أوامر التشغيل
    START: ['start', 'شغل', 'انطلق', 'بدء'],
    STOP: ['stop', 'قف', 'ايقاف', 'وقف'],
    STATS: ['stats', 'احصائيات', 'إحصائيات'],
    RESULTS: ['results', 'نتائج'],
    HELP: ['help', 'مساعدة', 'اوامر']
};
// =================================================================

// عميل HTTP ذكي
const http = axios.create({
    baseURL: 'https://discord.com/api/v9',
    headers: { 'Authorization': CHECKER_TOKEN, 'Content-Type': 'application/json' },
    timeout: 3000
});

// ================== توليد الأسماء ==================
function* usernameGenerator() {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const rareLetters = 'xyzqwk';
    
    // أنماط نادرة أولاً
    for (let l of rareLetters) {
        for (let d of digits) {
            yield l + l + l + d;  // xxx1
            yield l + l + d + l;  // xx1x
            yield l + d + l + l;  // x1xx
            yield d + l + l + l;  // 1xxx
        }
    }
    
    // أنماط متكررة
    for (let l1 of letters) {
        for (let l2 of letters) {
            if (l1 !== l2) {
                yield l1 + l1 + l2 + l2;  // aabb
                yield l1 + l2 + l1 + l2;  // abab
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

// ================== محرك السرعة ==================
async function speedEngine(message) {
    const gen = usernameGenerator();
    stats.startTime = Date.now();
    
    const statusMsg = await message.reply("🚀 **محرك السرعة انطلق!** ⚡");
    
    let batch = [];
    let foundBatch = [];
    
    // مراقب السرعة
    let speedInterval = setInterval(() => {
        if (stats.startTime && stats.checked > 0) {
            const elapsed = (Date.now() - stats.startTime) / 1000;
            stats.speed = (stats.checked / elapsed).toFixed(1);
        }
    }, 3000);
    
    while (generationActive) {
        const { value: username, done } = gen.next();
        if (done) break;
        
        batch.push(username);
        
        if (batch.length >= BATCH_SIZE) {
            const delay = BASE_DELAY + Math.random() * JITTER;
            
            const promises = batch.map(u => 
                http.post('/users/@me/username-attempt', { username: u })
                .then(r => ({ name: u, available: !r.data.taken }))
                .catch(e => ({ name: u, available: false, error: e.response?.status }))
            );
            
            const results = await Promise.all(promises);
            
            for (const res of results) {
                stats.checked++;
                
                if (res.available) {
                    stats.found++;
                    foundBatch.push(res.name);
                    fs.appendFileSync('./results/available.txt', res.name + '\n');
                }
                
                if (res.error === 401) {
                    generationActive = false;
                    clearInterval(speedInterval);
                    return message.reply("❌ **التوكن مات!** غير التوكن بسرعة");
                }
                
                if (res.error === 429) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            // إرسال الأسماء المتاحة (كل 3 أسماء)
            if (foundBatch.length >= 3) {
                message.channel.send(`⚡ **${foundBatch.join('**, **')}** ✅`);
                foundBatch = [];
            }
            
            // تحديث السرعة كل 50 اسم
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
    message.channel.send(`🏁 **انتهى!**\n⚡ سرعة: ${stats.speed} اسم/ثانية\n📊 فحص: ${stats.checked}\n✅ وجد: ${stats.found}`);
}

// ================== معالج الأوامر (عربي + إنجليزي) ==================
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;
    if (!message.content.startsWith('!')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    
    // ===== أمر التشغيل (عربي + إنجليزي) =====
    if (COMMANDS.START.includes(cmd)) {
        if (generationActive) {
            return message.reply("⚡ المحرك شغال بالفعل! استخدم `!قف` أو `!stop`");
        }
        generationActive = true;
        stats = { checked: 0, found: 0, startTime: null, speed: 0 };
        speedEngine(message);
    }
    
    // ===== أمر الإيقاف (عربي + إنجليزي) =====
    else if (COMMANDS.STOP.includes(cmd)) {
        generationActive = false;
        message.reply("🛑 **تم إيقاف المحرك**");
    }
    
    // ===== أمر الإحصائيات (عربي + إنجليزي) =====
    else if (COMMANDS.STATS.includes(cmd)) {
        const elapsed = stats.startTime ? ((Date.now() - stats.startTime) / 1000).toFixed(1) : 0;
        
        const embed = new EmbedBuilder()
            .setTitle('📊 الإحصائيات | Statistics')
            .setColor(0x00ff00)
            .addFields(
                { name: '⚡ السرعة | Speed', value: `${stats.speed} name/s`, inline: true },
                { name: '📊 تم الفحص | Checked', value: stats.checked.toString(), inline: true },
                { name: '✅ تم العثور | Found', value: stats.found.toString(), inline: true },
                { name: '⏱️ الوقت | Time', value: `${elapsed}s`, inline: true },
                { name: '🎯 نسبة النجاح | Rate', value: stats.checked ? `${((stats.found/stats.checked)*100).toFixed(3)}%` : '0%', inline: true },
                { name: '🟢 الحالة | Status', value: generationActive ? 'شغال | Active' : 'متوقف | Stopped', inline: true }
            );
        
        message.channel.send({ embeds: [embed] });
    }
    
    // ===== أمر النتائج (عربي + إنجليزي) =====
    else if (COMMANDS.RESULTS.includes(cmd)) {
        if (fs.existsSync('./results/available.txt')) {
            const data = fs.readFileSync('./results/available.txt', 'utf8').split('\n').filter(Boolean);
            
            if (data.length === 0) {
                return message.reply("📭 لا توجد نتائج بعد | No results yet");
            }
            
            let response = `📁 **النتائج | Results:** ${data.length} اسم\n`;
            response += `📋 آخر 10 | Last 10: ${data.slice(-10).join(', ')}`;
            
            message.channel.send(response);
            message.channel.send({ files: ['./results/available.txt'] });
        } else {
            message.reply("📭 لا توجد نتائج بعد | No results yet");
        }
    }
    
    // ===== أمر المساعدة (عربي + إنجليزي) =====
    else if (COMMANDS.HELP.includes(cmd)) {
        const embed = new EmbedBuilder()
            .setTitle('⚡ أوامر البوت | Bot Commands')
            .setDescription('**عربي / English**')
            .setColor(0xff5500)
            .addFields(
                { name: '🚀 التشغيل | Start', value: '`!start`, `!شغل`, `!انطلق`, `!بدء`', inline: false },
                { name: '🛑 الإيقاف | Stop', value: '`!stop`, `!قف`, `!ايقاف`, `!وقف`', inline: false },
                { name: '📊 الإحصائيات | Stats', value: '`!stats`, `!احصائيات`, `!إحصائيات`', inline: false },
                { name: '📁 النتائج | Results', value: '`!results`, `!نتائج`', inline: false },
                { name: '❓ المساعدة | Help', value: '`!help`, `!مساعدة`, `!اوامر`', inline: false }
            )
            .setFooter({ text: '⚡ سرعة 6-7 أسماء/الثانية' });
        
        message.channel.send({ embeds: [embed] });
    }
});

// ================== Keep Alive ==================
const app = express();
app.get('/', (req, res) => res.send('Bot Active ⚡'));
app.listen(3000);

client.on('ready', () => {
    console.log(`✅ البوت جاهز: ${client.user.tag}`);
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (channel) {
        channel.send("⚡ **البوت السريع جاهز!**\nأوامر عربي وإنجليزي: `!help` / `!مساعدة`");
    }
});

client.login(TOKEN);