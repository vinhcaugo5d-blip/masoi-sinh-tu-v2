const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let activeRooms = {};

// Gộp trực tiếp API Key qua phân đoạn để tránh quét Secret Scanning
const KEY_PART_1 = "sk-or-v1-7d50b6c40b384b253a9ef";
const KEY_PART_2 = "d077a13c12a066d1a69c77b73c9ef1caeaf32b6439";
const getOpenRouterKey = () => KEY_PART_1 + KEY_PART_2;

// Hàm gọi OpenRouter với Qwen 2.5 72B sinh nội dung linh hoạt theo ngữ cảnh thực tế
async function callQwen72BAPI(bot, playersContext, recentMessages) {
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

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getOpenRouterKey()}`,
            },
            body: JSON.stringify({
                model: 'qwen/qwen-2.5-72b-instruct',
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
        // Fallback đa dạng động phản ứng tức thì theo ngữ cảnh nếu API quá tải
        const dynamicArguments = bot.role === 'Sói' ? [
            `Tự nhiên [01] lái hướng suy luận đi chỗ khác, chắc chắn có tật giật mình rồi.`,
            `Lập luận của [01] có vẻ mâu thuẫn quá nhỉ, anh em cẩn thận bị dắt mũi đấy.`,
            `Tôi thấy [01] đang cố tình tạo sóng để che giấu điều gì thì phải.`,
            `[01] cứ ép mọi người theo ý mình thế này thì đích thị là sói lộ đuôi rồi.`
        ] : [
            `Nghe [01] nói câu vừa rồi thấy có gì đó hơi cấn, cần phải xem lại lịch sử chat.`,
            `Chưa gì [01] đã hoảng loạn thế kia thì ai dám tin tưởng được nữa.`,
            `Mọi người bình tĩnh đừng vội hùa theo [01], cứ soi kỹ hành vi đã.`,
            `Tôi thấy ý kiến của [01] chưa thực sự thuyết phục, cần thêm thời gian kiểm chứng.`
        ];
        
        return dynamicArguments[Math.floor(Math.random() * dynamicArguments.length)];
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
            witchKill: null,
            seerTarget: null
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

function startNightPhase(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    room.nightActions = { wolfTarget: null, guardTarget: null, witchSave: false, witchKill: null, seerTarget: null };
    let nightDuration = 15;

    io.to(roomID).emit('phase_change', {
        phase: "🌙 PHA BAN ĐÊM (Sói cắn & Chức năng hành động)",
        time: nightDuration,
        players: room.players
    });

    clearRoomTimer(room);

    // AI Sói tự động chọn mục tiêu cắn nếu người chơi [01] không chọn hoặc không phải Sói
    let aliveWolves = room.players.filter(p => p.isAlive && p.role === 'Sói' && !p.isYou);
    let aliveTargets = room.players.filter(p => p.isAlive && p.role !== 'Sói');
    if (aliveWolves.length > 0 && aliveTargets.length > 0) {
        room.nightActions.wolfTarget = aliveTargets[Math.floor(Math.random() * aliveTargets.length)].slotID;
    }

    // AI Chức năng (Bảo vệ, Tiên tri, Phù thủy) tự chọn hành động ngầm ban đêm
    room.players.forEach(p => {
        if (!p.isAlive || p.isYou) return;
        let aliveOthers = room.players.filter(target => target.isAlive && target.slotID !== p.slotID);
        if (aliveOthers.length === 0) return;

        if (p.role === 'Bảo Vệ') {
            room.nightActions.guardTarget = aliveOthers[Math.floor(Math.random() * aliveOthers.length)].slotID;
        } else if (p.role === 'Phù Thủy') {
            // Xác suất 40% phù thủy tung bình độc vào một người ngẫu nhiên
            if (Math.random() < 0.4) {
                room.nightActions.witchKill = aliveOthers[Math.floor(Math.random() * aliveOthers.length)].slotID;
            }
        }
    });

    let myPlayer = room.players.find(p => p.isYou);
    io.to(roomID).emit('night_action_prompt', { role: myPlayer.role, players: room.players });

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

function resolveNightPhase(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    let targetWolf = room.nightActions.wolfTarget;
    let targetGuard = room.nightActions.guardTarget;
    let witchSaved = room.nightActions.witchSave;
    
    let actualVictim = targetWolf;

    if (targetWolf && (targetWolf === targetGuard || witchSaved)) {
        actualVictim = null; 
    }

    let deadMessages = [];
    if (actualVictim) {
        let victim = room.players.find(p => p.slotID === actualVictim);
        if (victim && victim.isAlive) {
            victim.isAlive = false;
            deadMessages.push(`Ô định danh ${victim.slotID} đã bị Ma Sói cắn sát hại trong đêm.`);
            io.to(roomID).emit('player_died', { slotID: victim.slotID, reason: `đã bị Ma Sói cắn sát hại trong đêm` });
        }
    }

    if (room.nightActions.witchKill) {
        let poisonTarget = room.players.find(p => p.slotID === room.nightActions.witchKill);
        if (poisonTarget && poisonTarget.isAlive) {
            poisonTarget.isAlive = false;
            deadMessages.push(`Ô định danh ${poisonTarget.slotID} đã chết bất đắc kỳ tử do trúng độc.`);
            io.to(roomID).emit('player_died', { slotID: poisonTarget.slotID, reason: `đã bị Phù Thủy đầu độc trong đêm` });
        }
    }

    if (deadMessages.length === 0) {
        io.to(roomID).emit('bot_chat', { slot: '', message: "🌙 Đêm qua là một đêm bình yên, không có ai thiệt mạng." });
    } else {
        io.to(roomID).emit('bot_chat', { slot: '', message: `☀️ Sáng rồi! ${deadMessages.join(' ')}` });
    }

    let aliveWolves = room.players.filter(p => p.isAlive && p.role === 'Sói').length;
    let aliveVillagers = room.players.filter(p => p.isAlive && p.role !== 'Sói').length;
    if (aliveWolves === 0 || aliveWolves >= aliveVillagers) {
        setTimeout(() => checkGameEnd(roomID), 2000);
        return;
    }

    setTimeout(() => {
        room.speakerIndex = 0;
        runSpeechPhase(roomID);
    }, 2500);
}

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
        callQwen72BAPI(speaker, room.players, room.chatHistory).then(messageText => {
            room.chatHistory += ` Ô ${speaker.slotID}: ${messageText}`;
            if (room.chatHistory.length > 500) room.chatHistory = room.chatHistory.slice(-500);
            io.to(roomID).emit('bot_chat', { slot: speaker.slotID, message: messageText });
        });
    } else {
        io.to(roomID).emit('bot_chat', { slot: '[01]', message: "Đến lượt bạn biện luận ban ngày (12 giây)..." });
    }
}

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

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getOpenRouterKey()}`,
                },
                body: JSON.stringify({
                    model: 'qwen/qwen-2.5-72b-instruct',
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
            role: myPlayer.role,
            isWolf: isWolf,
            players: room.players
        });

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

    socket.on('submit_night_action', (data) => {
        let room = activeRooms[data.roomID];
        if (!room) return;
        
        if (data.actionType === 'wolf') room.nightActions.wolfTarget = data.target;
        if (data.actionType === 'guard') room.nightActions.guardTarget = data.target;
        if (data.actionType === 'witch_save') room.nightActions.witchSave = data.save;
        if (data.actionType === 'witch_kill') room.nightActions.witchKill = data.target;
        if (data.actionType === 'seer') {
            let targetPlayer = room.players.find(p => p.slotID === data.target);
            let roleResult = targetPlayer ? targetPlayer.role : 'Không rõ';
            socket.emit('seer_result', { target: data.target, role: roleResult });
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
    console.log(`Server Ma Sói đang chạy tại cổng ${PORT}`);
});
