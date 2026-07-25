const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Danh sách cấp bậc rank từ thấp đến cao, khởi tạo mặc định cho test là "Chiến Thần"
const RANKS = ["Đồng", "Bạc", "Vàng", "Bạch Kim", "Kim Cương", "Cao Thủ", "Đại Cao Thủ", "Chiến Thần"];

// Mô phỏng lõi Qwen-72B xử lý logic & biện luận thông minh cho Bot ở mức Chiến Thần
async function qwen72BAnalyzeAndChat(botSlot, players) {
    const aiDialogues = [
        `Phân tích logic từ Qwen-72B: Ô ${botSlot} thấy nhịp độ vote hôm nay có vấn đề, khả năng cao phe Sói đang ẩn mình ở các ô chẵn.`,
        `Dựa trên tư duy chiến thuật Chiến Thần: Các bạn đừng hoảng loạn, hãy nhìn lại lịch sử phát ngôn của ô [03] và [07].`,
        `Qwen-72B Engine: Đã quét hành vi 12 người chơi. Tỷ lệ ô nghi vấn cao nhất là kẻ ít nói từ đầu trận.`,
        `Chiến thuật cấp Chiến Thần: Tôi giữ quan điểm bảo vệ phe chức năng, ai định hướng lệch hướng nên bị treo cổ.`
    ];
    return aiDialogues[Math.floor(Math.random() * aiDialogues.length)];
}

io.on('connection', (socket) => {
    socket.on('find_match', (data) => {
        let roomID = 'MS' + Math.floor(1000 + Math.random() * 9000);
        socket.join(roomID);

        let players = [];
        const rolesPool = ["Sói Thường", "Sói Thường", "Sói Trưởng", "Phù Thủy", "Bảo Vệ", "Cô Bé", "Cupid", "Dân Làng", "Dân Làng", "Dân Làng", "Dân Làng", "Dân Làng"];
        rolesPool.sort(() => Math.random() - 0.5);

        for (let i = 0; i < 12; i++) {
            let slotCode = `[${(i + 1).toString().padStart(2, '0')}]`;
            let gender = Math.random() < 0.5 ? 'Nam' : 'Nữ';
            
            players.push({
                slotID: slotCode,
                gender: gender,
                role: rolesPool[i],
                rank: "Chiến Thần", // Thiết lập mức rank khởi điểm để test trình độ cao nhất
                isAlive: true,
                isWolf: rolesPool[i].includes("Sói")
            });
        }

        socket.emit('match_started', { roomID, players, mySlot: '[01]', isWolf: players[0].isWolf });
        startDayPhase(roomID, players);
    });

    socket.on('player_chat', (data) => {
        socket.to(data.roomID).emit('receive_message', { sender: '[Bạn]', message: data.message });
    });

    socket.on('wolf_chat', (data) => {
        socket.to(data.roomID).emit('receive_wolf_message', { sender: '[Sói Đồng Minh]', message: data.message });
    });

    socket.on('submit_vote', (data) => {
        io.to(data.roomID).emit('vote_recorded', { voter: data.voter, target: data.target });
    });
});

function startDayPhase(roomID, players) {
    let timeLeft = 35;
    io.to(roomID).emit('phase_change', { phase: 'Thảo luận ngày (Rank Chiến Thần)', time: timeLeft, isNight: false });

    let timer = setInterval(async () => {
        timeLeft--;
        
        // Kích hoạt Qwen-72B để Bot tự động chat biện luận theo tư duy Chiến Thần
        if (timeLeft % 7 === 0) {
            let aliveBots = players.filter(p => p.isAlive);
            if (aliveBots.length > 0) {
                let randomBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
                let aiText = await qwen72BAnalyzeAndChat(randomBot.slotID, players);
                io.to(roomID).emit('bot_chat', { slot: randomBot.slotID, message: aiText });
            }
        }

        if (timeLeft <= 0) {
            clearInterval(timer);
            startVotePhase(roomID, players);
        } else {
            io.to(roomID).emit('update_timer', { time: timeLeft });
        }
    }, 1000);
}

function startVotePhase(roomID, players) {
    let timeLeft = 15;
    io.to(roomID).emit('phase_change', { phase: 'Bỏ phiếu treo cổ', time: timeLeft, isNight: false });
    io.to(roomID).emit('enable_voting', { players });

    let timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timer);
            startNightPhase(roomID, players);
        } else {
            io.to(roomID).emit('update_timer', { time: timeLeft });
        }
    }, 1000);
}

function startNightPhase(roomID, players) {
    let timeLeft = 20;
    io.to(roomID).emit('phase_change', { phase: 'Đêm tối (Sói hành động)', time: timeLeft, isNight: true });

    let timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timer);
            startDayPhase(roomID, players);
        } else {
            io.to(roomID).emit('update_timer', { time: timeLeft });
        }
    }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Hệ thống Ma Sói Qwen-72B (Chiến Thần) đang chạy tại cổng ${PORT}`);
});
