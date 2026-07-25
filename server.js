const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const botSentences = [
    "Tôi thấy ô [02] từ đầu trận đến giờ có biểu hiện hơi đáng nghi.",
    "Mọi người bình tĩnh, tôi là dân lành chính hiệu, đừng vote bậy.",
    "Ô [05] nói ít thế nhỉ, chắc chắn là Sói rồi.",
    "Ai có thông tin gì chưa? Đêm qua ai bị cắn thế?",
    "Tôi vote ô [08] nhé, nhìn cách biện luận bất ổn lắm."
];

io.on('connection', (socket) => {
    socket.on('find_match', () => {
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
                isAlive: true,
                isWolf: rolesPool[i].includes("Sói")
            });
        }

        // Gán ngẫu nhiên người chơi thực ở slot [01] hoặc cho phép tùy chọn, ở đây cấp mặc định slot [01] là người chơi
        socket.emit('match_started', { roomID, players, mySlot: '[01]', isWolf: players[0].isWolf });

        // Vòng lặp quản lý thời gian trận đấu
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
    let timeLeft = 30; // 30s thảo luận
    io.to(roomID).emit('phase_change', { phase: 'Thảo luận ngày', time: timeLeft, isNight: false });

    let timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timer);
            startVotePhase(roomID, players);
        } else {
            io.to(roomID).emit('update_timer', { time: timeLeft });
        }
    }, 1000);
}

function startVotePhase(roomID, players) {
    let timeLeft = 15; // 15s bỏ phiếu
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
    let timeLeft = 20; // 20s ban đêm
    io.to(roomID).emit('phase_change', { phase: 'Đêm tối (Sói hành động)', time: timeLeft, isNight: true });

    let timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timer);
            startDayPhase(roomID, players); // Vòng lặp sang ngày mới
        } else {
            io.to(roomID).emit('update_timer', { time: timeLeft });
        }
    }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Ma Sói đang chạy tại cổng ${PORT}`);
});
