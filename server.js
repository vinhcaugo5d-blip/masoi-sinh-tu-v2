const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let activeRooms = {};

// Hàm gọi Qwen-72B tạo phát biểu sắc sảo theo vai trò
async function callQwen72BAPI(bot, playersContext, recentMessages) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let roleDirective = "";
    if (bot.role === 'Sói') {
        roleDirective = "Bạn là Sói giả dạng Dân Làng. Hãy tìm cách chối tội, bẻ lái hướng mũi dùi sang người khác.";
    } else if (bot.role === 'Tiên Tri') {
        roleDirective = "Bạn là Tiên Tri. Hãy khéo léo tung hint dẫn dắt dân làng mà không để Sói thịt sớm.";
    } else if (bot.role === 'Bảo Vệ' || bot.role === 'Phù Thủy') {
        roleDirective = "Bạn có chức năng bảo vệ phe thiện. Hãy tỏ ra sắc sảo, chất vấn logic sơ hở của kẻ khả nghi.";
    } else {
        roleDirective = "Bạn là Dân Làng thuần túy. Hãy dựa vào phát ngôn để đặt câu hỏi hoặc hùa theo hướng vote.";
    }

    try {
        const prompt = `Bạn là người chơi định danh ${bot.slotID}, giới tính ${bot.gender}, rank ${bot.rank} trong game Ma Sói 12 người.
Nhiệm vụ & Đối sách: ${roleDirective}
Vai trò bí mật (Giữ kín): ${bot.role}.
Danh sách còn sống: ${JSON.stringify(playersContext.filter(p => p.isAlive).map(p => p.slotID))}.
Phòng chat gần đây: "${recentMessages || 'Mọi người bắt đầu dò xét nhau'}".

Yêu cầu: Viết MỘT câu phát biểu ngắn gọn (dưới 25 từ), sắc sảo, đậm chất game thủ bằng tiếng Việt. Tuyệt đối không dùng văn mẫu!`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer sk-or-v1-YOUR_ACTUAL_API_KEY_HERE',
            },
            body: JSON.stringify({
                model: 'qwen/qwen-72b-instruct',
                messages: [
                    { role: 'system', content: 'Bạn là game thủ chuyên nghiệp chơi Ma Sói, cực kỳ nhạy bén và có chính kiến.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.95,
                max_tokens: 80
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
            return `Ô ${bot.slotID}: Ô [01] đang cố tình vu khống để che đậy điều gì đó!`;
        } else {
            return `Ô ${bot.slotID}: Hướng phân tích này có ý đúng, chúng ta cần soi kỹ hành vi mọi người.`;
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
        chatHistory: ""
    };

    return activeRooms[roomID];
}

function clearRoomTimer(room) {
    if (room.currentTimer) {
        clearInterval(room.currentTimer);
        room.currentTimer = null;
    }
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
        callQwen72BAPI(speaker, room.players, room.chatHistory).then(messageText => {
            room.chatHistory += ` Ô ${speaker.slotID}: ${messageText}`;
            if (room.chatHistory.length > 300) room.chatHistory = room.chatHistory.slice(-300);
            io.to(roomID).emit('bot_chat', { slot: speaker.slotID, message: messageText });
        });
    } else {
        io.to(roomID).emit('bot_chat', { slot: '[01]', message: "Đến lượt bạn biện luận (15 giây)..." });
    }
}

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

// Tổng kết phiếu bầu thông minh: Bot dùng AI phân tích để vote
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

            let roleGoal = bot.role === 'Sói' 
                ? "Bạn là Sói, hãy chọn vote hùa hoặc dắt mũi treo cổ một Dân Làng." 
                : "Bạn là phe thiện, hãy phân tích lịch sử chat để vote loại bỏ kẻ khả nghi nhất.";

            const prompt = `Bạn là ô ${bot.slotID} (${bot.gender}, rank ${bot.rank}), vai trò: ${bot.role}.
Mục tiêu: ${roleGoal}
Danh sách còn sống: ${JSON.stringify(alivePlayers.map(p => p.slotID))}.
Lịch sử chat: "${room.chatHistory || 'Tranh luận gay gắt'}".

Yêu cầu: Chỉ trả về ĐÚNG MỘT mã số ô bạn muốn vote (Ví dụ: [02], [05],...). Không giải thích!`;

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer sk-or-v1-YOUR_ACTUAL_API_KEY_HERE',
                },
                body: JSON.stringify({
                    model: 'qwen/qwen-72b-instruct',
                    messages: [
                        { role: 'system', content: 'Bạn là bot chơi Ma Sói mưu mẹo, quyết định vote dựa trên logic.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 20
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
            io.to(roomID).emit('player_died', { slotID: eliminatedSlot, reason: `đã bị cộng đồng biểu quyết treo cổ với ${maxVotes} phiếu` });
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

    socket.on('disconnect', () => {
        console.log(`Client ngắt kết nối: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Ma Sói Sinh Tử đang chạy thành công tại cổng ${PORT}`);
});
