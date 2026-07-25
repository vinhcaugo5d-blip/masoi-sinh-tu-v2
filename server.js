const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let activeRooms = {};

// Hàm gọi OpenAI ChatGPT API cho bot phát biểu ban ngày
async function callChatGPTAPI(bot, playersContext, recentMessages) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let roleDirective = "";
    if (bot.role === 'Sói') {
        roleDirective = "Bạn là Sói giả dạng Dân Làng. Hãy tìm cách chối tội, bẻ lái hoặc công kích người chơi [01] một cách sắc sảo.";
    } else if (bot.role === 'Tiên Tri') {
        roleDirective = "Bạn là Tiên Tri. Hãy khéo léo tung hint dẫn dắt dân làng mà không để Sói phát hiện.";
    } else if (bot.role === 'Bảo Vệ' || bot.role === 'Phù Thủy') {
        roleDirective = "Bạn có chức năng bảo vệ phe thiện. Hãy tỏ ra sắc sảo, chất vấn logic của người chơi khác.";
    } else {
        roleDirective = "Bạn là Dân Làng thuần túy. Hãy dựa vào những gì người chơi [01] vừa nói để chất vấn hoặc tranh luận lại.";
    }

    try {
        const prompt = `Bạn là người chơi ${bot.slotID} (${bot.gender}, rank ${bot.rank}) trong game Ma Sói 12 người.
Nhiệm vụ & Đối sách: ${roleDirective}
Vai trò bí mật (Giữ kín): ${bot.role}.
Lịch sử chat gần đây trong phòng: "${recentMessages || 'Mọi người đang bắt đầu dò xét nhau'}".

Yêu cầu: Viết MỘT câu phát biểu cực kỳ ngắn gọn (dưới 20 từ), tự nhiên như game thủ thật bằng tiếng Việt để phản hồi lại ý kiến của ô [01]. Tuyệt đối không dùng văn mẫu chung chung!`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer sk-YOUR_OPENAI_API_KEY_HERE', // Thay API Key OpenAI thật của bạn vào đây
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'Bạn là game thủ chuyên nghiệp chơi Ma Sói, cực kỳ nhạy bén, biết cách cãi tay đôi và bám sát ngữ cảnh.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.9,
                max_tokens: 60
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content.trim();
        }
        throw new Error('Empty API response');

    } catch (error) {
        clearTimeout(timeoutId);
        if (bot.role === 'Sói') {
            return `Ô ${bot.slotID}: Tự nhiên [01] hỏi câu vu vơ thế, chắc đang chột dạ à?`;
        } else {
            return `Ô ${bot.slotID}: Tôi thấy [01] hỏi hơi lạ, bình tĩnh xem xét đã chứ.`;
        }
    }
}

function createNewRoom(roomID, hostSocketID) {
    const genders = ['Nam', 'Nữ'];
    const ranks = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương', 'Cao Thủ', 'Đại Cao Thủ', 'Chiến Thần'];
    const rolesPool = ['Sói', 'Sói', 'Sói', 'Phù Thủy', 'Bảo Vệ', 'Tiên Tri', 'Dân', 'Dân', 'Dân', 'Dân', 'Dân', 'Dân'];
    
    rolesPool.sort(() => Math.random() - 0.5);

    let players = [];
    for (let i = 1; i <= 12; i++) {
        let slotStr = i < 10 ? `[0${i}]` : `[${i}]`;
        let isYou = (i === 1);
        players.push({
            id: isYou ? hostSocketID : `bot_${i}`,
            socketID: isYou ? hostSocketID : null,
            slotID: slotStr,
            isYou: isYou,
            isAlive: true,
            role: rolesPool[i - 1],
            gender: genders[Math.floor(Math.random() * genders.length)],
            rank: ranks[Math.floor(Math.random() * ranks.length)]
        });
    }

    activeRooms[roomID] = {
        roomID: roomID,
        players: players,
        speakerIndex: 0,
        currentTimer: null,
        votes: {},
        chatHistory: "",
        nightActions: {
            wolfTarget: null,
            guardTarget: null,
            witchSave: false,
            witchKill: null
        }
    };

    return activeRooms[roomID];
}

function clearRoomTimer(room) {
    if (room.currentTimer) {
        clearInterval(room.currentTimer);
        room.currentTimer = null;
    }
}

// BƯỚC 1: KHỞI ĐẦU PHA BAN ĐÊM
function startNightPhase(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    // Reset hành động đêm
    room.nightActions = { wolfTarget: null, guardTarget: null, witchSave: false, witchKill: null };
    let nightDuration = 15;

    io.to(roomID).emit('phase_change', {
        phase: "🌙 PHA BAN ĐÊM (Sói cắn, Chức năng hành động)",
        time: nightDuration,
        players: room.players
    });

    clearRoomTimer(room);

    // Bot Sói tự chọn mục tiêu cắn trong đêm
    let aliveWolves = room.players.filter(p => p.isAlive && p.role === 'Sói' && !p.isYou);
    let aliveTargets = room.players.filter(p => p.isAlive && p.role !== 'Sói');
    if (aliveWolves.length > 0 && aliveTargets.length > 0) {
        let chosenWolfTarget = aliveTargets[Math.floor(Math.random() * aliveTargets.length)].slotID;
        room.nightActions.wolfTarget = chosenWolfTarget;
    }

    room.currentTimer = setInterval(() => {
        nightDuration--;
        if (nightDuration <= 0) {
            clearRoomTimer(room);
            resolveNightPhase(roomID);
        } else {
            io.to(roomID).emit('update_timer', { time: nightDuration });
        }
    }, 1000);
}

// BƯỚC 2: TỔNG KẾT KẾT QUẢ ĐÊM QUA & CHUYỂN SANG BAN NGÀY
function resolveNightPhase(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    let targetWolf = room.nightActions.wolfTarget;
    let deadMessages = [];

    if (targetWolf) {
        let victim = room.players.find(p => p.slotID === targetWolf);
        if (victim && victim.isAlive) {
            victim.isAlive = false;
            deadMessages.push(`Ô định danh ${victim.slotID} đã bị Ma Sói cắn xé vào ban đêm.`);
            io.to(roomID).emit('player_died', { slotID: victim.slotID, reason: `đã bị Ma Sói cắn sát hại trong đêm` });
        }
    }

    if (deadMessages.length === 0) {
        io.to(roomID).emit('bot_chat', { slot: '', message: "🌙 Đêm qua là một đêm bình yên, không có ai thiệt mạng." });
    } else {
        io.to(roomID).emit('bot_chat', { slot: '', message: `☀️ Sáng rồi! ${deadMessages.join(' ')}` });
    }

    // Kiểm tra xem game đã kết thúc sau đêm chưa
    let aliveWolves = room.players.filter(p => p.isAlive && p.role === 'Sói').length;
    let aliveVillagers = room.players.filter(p => p.isAlive && p.role !== 'Sói').length;
    if (aliveWolves === 0 || aliveWolves >= aliveVillagers) {
        setTimeout(() => checkGameEnd(roomID), 2000);
        return;
    }

    // Chuyển sang pha phát biểu ban ngày
    setTimeout(() => {
        room.speakerIndex = 0;
        runSpeechPhase(roomID);
    }, 2500);
}

// BƯỚC 3: PHA PHÁT BIỂU BAN NGÀY
function runSpeechPhase(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    let alivePlayers = room.players.filter(p => p.isAlive);
    if (room.speakerIndex >= alivePlayers.length) {
        room.speakerIndex = 0;
        startVotePhase(roomID);
        return;
    }

    let speaker = alivePlayers[room.speakerIndex];
    room.speakerIndex++;

    let speakDuration = 12;

    io.to(roomID).emit('phase_change', { 
        phase: `☀️ Phát biểu ban ngày: ${speaker.slotID}`, 
        time: speakDuration, 
        players: room.players 
    });

    clearRoomTimer(room);

    room.currentTimer = setInterval(() => {
        speakDuration--;
        if (speakDuration <= 0) {
            clearRoomTimer(room);
            runSpeechPhase(roomID);
        } else {
            io.to(roomID).emit('update_timer', { time: speakDuration });
        }
    }, 1000);

    if (!speaker.isYou) {
        callChatGPTAPI(speaker, room.players, room.chatHistory).then(messageText => {
            room.chatHistory += ` Ô ${speaker.slotID}: ${messageText}`;
            if (room.chatHistory.length > 500) room.chatHistory = room.chatHistory.slice(-500);
            io.to(roomID).emit('bot_chat', { slot: speaker.slotID, message: messageText });
        });
    } else {
        io.to(roomID).emit('bot_chat', { slot: '[01]', message: "Đến lượt bạn biện luận ban ngày (12 giây)..." });
    }
}

// BƯỚC 4: PHA BIỂU QUYẾT TREO CỔ BAN NGÀY
function startVotePhase(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    room.votes = {};
    let voteDuration = 15;

    io.to(roomID).emit('phase_change', {
        phase: "⚖️ Giai Đoạn Biểu Quyết Treo Cổ Ban Ngày",
        time: voteDuration,
        players: room.players
    });

    io.to(roomID).emit('enable_voting', { players: room.players });

    clearRoomTimer(room);

    room.currentTimer = setInterval(() => {
        voteDuration--;
        if (voteDuration <= 0) {
            clearRoomTimer(room);
            resolveVotes(roomID);
        } else {
            io.to(roomID).emit('update_timer', { time: voteDuration });
        }
    }, 1000);
}

async function resolveVotes(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    let alivePlayers = room.players.filter(p => p.isAlive);

    for (let bot of alivePlayers) {
        if (bot.isYou) continue;

        let chosenTargetSlot = null;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            const prompt = `Bạn là ô ${bot.slotID}, vai trò: ${bot.role}. 
Lịch sử chat: "${room.chatHistory || ''}". 
Danh sách còn sống: ${JSON.stringify(alivePlayers.map(p => p.slotID))}.
Yêu cầu: Chỉ trả về ĐÚNG MỘT mã số ô bạn muốn vote (Ví dụ: [02], [05],...). Không giải thích!`;

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer sk-YOUR_OPENAI_API_KEY_HERE',
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 15
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const data = await response.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                let text = data.choices[0].message.content.trim();
                let match = text.match(/\[?0?(\d+)\]?/);
                if (match) {
                    let num = parseInt(match[1]);
                    let targetStr = num < 10 ? `[0${num}]` : `[${num}]`;
                    if (targetStr !== bot.slotID && alivePlayers.some(p => p.slotID === targetStr)) {
                        chosenTargetSlot = targetStr;
                    }
                }
            }
        } catch (e) {}

        if (!chosenTargetSlot) {
            let possibleTargets = alivePlayers.filter(p => p.slotID !== bot.slotID);
            if (possibleTargets.length > 0) {
                chosenTargetSlot = possibleTargets[Math.floor(Math.random() * possibleTargets.length)].slotID;
            }
        }

        room.votes[bot.slotID] = chosenTargetSlot;
        io.to(roomID).emit('vote_recorded', { voter: bot.slotID, target: chosenTargetSlot });
    }

    let voteCounts = {};
    Object.values(room.votes).forEach(target => {
        voteCounts[target] = (voteCounts[target] || 0) + 1;
    });

    let maxVotes = 0;
    let eliminatedSlot = null;
    for (let target in voteCounts) {
        if (voteCounts[target] > maxVotes) {
            maxVotes = voteCounts[target];
            eliminatedSlot = target;
        }
    }

    if (eliminatedSlot && maxVotes > 0) {
        let player = room.players.find(p => p.slotID === eliminatedSlot);
        if (player) {
            player.isAlive = false;
            io.to(roomID).emit('player_died', { slotID: eliminatedSlot, reason: `đã bị cộng đồng treo cổ ban ngày với ${maxVotes} phiếu` });
        }
    } else {
        io.to(roomID).emit('bot_chat', { slot: '', message: "Hòa phiếu, không ai bị treo cổ vòng này." });
    }

    setTimeout(() => checkGameEnd(roomID), 2000);
}

function checkGameEnd(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    let aliveWolves = room.players.filter(p => p.isAlive && p.role === 'Sói').length;
    let aliveVillagers = room.players.filter(p => p.isAlive && p.role !== 'Sói').length;

    if (aliveWolves === 0) {
        io.to(roomID).emit('game_over', { winner: "Phe Dân Làng & Chức Năng" });
        delete activeRooms[roomID];
        return;
    }
    if (aliveWolves >= aliveVillagers) {
        io.to(roomID).emit('game_over', { winner: "Phe Ma Sói Hung Ác" });
        delete activeRooms[roomID];
        return;
    }

    // Vòng lặp tiếp theo: Quay lại pha Đêm
    startNightPhase(roomID);
}

io.on('connection', (socket) => {
    socket.on('find_match', () => {
        const roomID = 'ROOM_' + Math.floor(1000 + Math.random() * 9000);
        socket.join(roomID);

        const room = createNewRoom(roomID, socket.id);
        const myPlayer = room.players.find(p => p.isYou);
        const isWolf = (myPlayer.role === 'Sói');

        socket.emit('match_started', {
            roomID: roomID,
            mySlot: myPlayer.slotID,
            isWolf: isWolf,
            players: room.players
        });

        // Bắt đầu game bằng Pha Ban Đêm đầu tiên
        setTimeout(() => {
            startNightPhase(roomID);
        }, 2000);
    });

    socket.on('player_chat', (data) => {
        let room = activeRooms[data.roomID];
        if (room) {
            room.chatHistory += ` Ô [01]: ${data.message}`;
        }
        socket.to(data.roomID).emit('receive_message', {
            sender: 'Ô [01]',
            message: data.message
        });
    });

    socket.on('wolf_chat', (data) => {
        let room = activeRooms[data.roomID];
        if (!room) return;
        let senderPlayer = room.players.find(p => p.socketID === socket.id);
        if (senderPlayer && senderPlayer.role === 'Sói') {
            socket.to(data.roomID).emit('receive_wolf_message', {
                sender: senderPlayer.slotID,
                message: data.message
            });
        }
    });

    socket.on('submit_vote', (data) => {
        let room = activeRooms[data.roomID];
        if (!room) return;
        room.votes[data.voter] = data.target;
        io.to(data.roomID).emit('vote_recorded', { voter: data.voter, target: data.target });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server chạy tại cổng ${PORT}`);
});
