const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Phục vụ các file tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Cấu trúc lưu trữ phòng chơi active
let activeRooms = {};

// Hàm gọi Qwen-72B thông qua Cloud API (chuẩn OpenAI)
async function callQwen72BAPI(bot, playersContext) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // Timeout 8s

    try {
        const prompt = `Bạn là một người chơi thông minh (mã số ${bot.slotID}, giới tính ${bot.gender}, rank Chiến Thần) trong game Ma Sói Sinh Tử 12 người. 
Vai trò bí mật của bạn là: ${bot.role}. 
Trạng thái các người chơi: ${JSON.stringify(playersContext.map(p => ({slot: p.slotID, alive: p.isAlive})))}.
Hãy viết một câu phát biểu ngắn gọn (dưới 30 từ) bằng tiếng Việt để biện luận hoặc định hướng vote. Không lan man.`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ĐIỀN_API_KEY_CỦA_BẠN_VÀO_ĐÂY', // Thay API key thực tế vào đây nếu dùng
            },
            body: JSON.stringify({
                model: 'qwen/qwen-72b-instruct',
                messages: [
                    { role: 'system', content: 'Bạn là một người chơi board game Ma Sói cực kỳ sắc sảo.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 100
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content.trim();
        }
        return "Tôi đang phân tích lại nhịp độ vote của mọi người...";

    } catch (error) {
        clearTimeout(timeoutId);
        const fallbacks = [
            `Phân tích Chiến Thần: Ô ${bot.slotID} thấy luồng thông tin lượt trước có mâu thuẫn lớn, cần kiểm chứng kỹ.`,
            `Tôi là dân, lượt này khuyến nghị mọi người quan sát động thái của các ô ẩn mình từ đầu trận.`,
            `Nhịp độ vote hiện tại đang bất lợi cho phe thiện. Đề nghị giữ bình tĩnh, chưa vội theo số đông.`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}

// Khởi tạo phòng 12 người (1 người chơi thực + 11 bot)
function createNewRoom(roomID, hostSocketID) {
    const genders = ['Nam', 'Nữ'];
    const ranks = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương', 'Cao Thủ', 'Đại Cao Thủ', 'Chiến Thần'];
    const rolesPool = ['Sói', 'Sói', 'Sói', 'Phù Thủy', 'Bảo Vệ', 'Tiên Tri', 'Dân', 'Dân', 'Dân', 'Dân', 'Dân', 'Dân'];
    
    // Xáo trộn ngẫu nhiên vai trò
    rolesPool.sort(() => Math.random() - 0.5);

    let players = [];
    for (let i = 1; i <= 12; i++) {
        let slotStr = i < 10 ? `[0${i}]` : `[${i}]`;
        let isYou = (i === 1); // Ô [01] luôn là người chơi thực
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
        votes: {}
    };

    return activeRooms[roomID];
}

function clearRoomTimer(room) {
    if (room.currentTimer) {
        clearInterval(room.currentTimer);
        room.currentTimer = null;
    }
}

// Vòng lặp phát biểu tuần tự
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

    let speakDuration = 15;

    io.to(roomID).emit('phase_change', { 
        phase: `Phát biểu 15s: ${speaker.slotID}`, 
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
        callQwen72BAPI(speaker, room.players).then(messageText => {
            io.to(roomID).emit('bot_chat', { slot: speaker.slotID, message: messageText });
        });
    } else {
        io.to(roomID).emit('bot_chat', { slot: '[01]', message: "Đến lượt bạn biện luận (15 giây)..." });
    }
}

// Pha bỏ phiếu treo cổ
function startVotePhase(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    room.votes = {};
    let voteDuration = 20;

    io.to(roomID).emit('phase_change', {
        phase: "Giai Đoạn Biểu Quyết Treo Cổ",
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

// Tổng kết phiếu bầu
function resolveVotes(roomID) {
    let room = activeRooms[roomID];
    if (!room) return;

    room.players.filter(p => p.isAlive && !p.isYou && !room.votes[p.slotID]).forEach(bot => {
        let targets = room.players.filter(p => p.isAlive && p.slotID !== bot.slotID);
        if (targets.length > 0) {
            let chosen = targets[Math.floor(Math.random() * targets.length)];
            room.votes[bot.slotID] = chosen.slotID;
        }
    });

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
            io.to(roomID).emit('player_died', { slotID: eliminatedSlot, reason: "đã bị cộng đồng biểu quyết treo cổ" });
        }
    } else {
        io.to(roomID).emit('bot_chat', { slot: '', message: "Kết quả hòa phiếu, không có ai bị treo cổ vòng này." });
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

    runSpeechPhase(roomID);
}

io.on('connection', (socket) => {
    console.log(`Client kết nối thành công: ${socket.id}`);

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

        setTimeout(() => {
            runSpeechPhase(roomID);
        }, 2000);
    });

    socket.on('player_chat', (data) => {
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

    socket.on('disconnect', () => {
        console.log(`Client ngắt kết nối: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Ma Sói Sinh Tử đang chạy thành công tại cổng ${PORT}`);
});
