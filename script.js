// Supabase configuration
const SUPABASE_URL = 'https://dpopxtljjdkkzcnxwyfx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwb3B4dGxqamRra3pjbnh3eWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQwODAyMjIsImV4cCI6MjA2OTY1NjIyMn0.udAGcJa2CjZfKec34_QL-uBymgu2g9x9mWRrelwr11I';

// Initialize Supabase client after the library loads
let supabase;

// Wait for Supabase to load
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Supabase client - try multiple approaches
    try {
        if (typeof window.supabase !== 'undefined') {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else if (typeof supabase !== 'undefined' && supabase.createClient) {
            supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else {
            throw new Error('Supabase library not found');
        }
        console.log('Supabase initialized successfully');
        showScreen('loginScreen');
    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        // Show error message to user
        document.body.innerHTML = `
            <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
                <h2>Connection Error</h2>
                <p>Failed to load the database connection.</p>
                <p>Please refresh the page or try again later.</p>
                <button onclick="location.reload()" style="padding: 10px 20px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Refresh Page
                </button>
            </div>
        `;
    }
});

// Game state
let currentUser = null;
let gameMode = 'practice';
let currentSession = null;
let realtimeSubscription = null;
let gameSession = {
    questions: [],
    currentQuestionIndex: 0,
    correctAnswers: 0,
    totalAnswers: 0,
    startTime: null,
    timeLeft: 60,
    timer: null,
    betAmount: 0,
    sessionCode: null,
    isMultiplayer: false
};

// Initialize the game
// (Removed DOMContentLoaded listener since it's now above)

    document.body.style.backgroundImage = "url('images/background1.png')";
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundRepeat = "no-repeat";

function showScreen(screenId) {
    const screens = ['loginScreen', 'mainMenu', 'competitionSetup', 'gameScreen', 'resultsScreen', 'leaderboardScreen'];
    screens.forEach(screen => {
        document.getElementById(screen).classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
    setTimeout(() => {
        errorElement.classList.add('hidden');
    }, 5000);
}

// Authentication functions
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        showError('loginError', 'Please enter both username and password');
        return;
    }

    try {
        const { data, error } = await supabase
            .from('users_v3')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();

        if (error || !data) {
            showError('loginError', 'Invalid username or password');
            return;
        }

        currentUser = data;
        document.getElementById('currentUser').textContent = currentUser.username;
        document.getElementById('userCurrency').textContent = currentUser.pomodoro_count || 0;
        showScreen('mainMenu');
    } catch (error) {
        showError('loginError', 'Login failed. Please try again.');
    }
}

async function register() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        showError('loginError', 'Please enter both username and password');
        return;
    }

    if (username.length < 3 || password.length < 3) {
        showError('loginError', 'Username and password must be at least 3 characters long');
        return;
    }

    try {
        // Check if username already exists
        const { data: existingUser } = await supabase
            .from('users_v3')
            .select('username')
            .eq('username', username)
            .single();

        if (existingUser) {
            showError('loginError', 'Username already exists');
            return;
        }

        // Create new user (pomodoro_count will use existing value or default from database)
        const { data, error } = await supabase
            .from('users_v3')
            .insert([
                { 
                    username: username, 
                    password: password
                }
            ])
            .select()
            .single();

        if (error) {
            showError('loginError', 'Registration failed. Please try again.');
            return;
        }

        currentUser = data;
        document.getElementById('currentUser').textContent = currentUser.username;
        document.getElementById('userCurrency').textContent = currentUser.pomodoro_count;
        showScreen('mainMenu');
    } catch (error) {
        showError('loginError', 'Registration failed. Please try again.');
    }
}

function logout() {
    currentUser = null;
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    showScreen('loginScreen');
}

// Game mode selection
function selectMode(mode) {
    gameMode = mode;
    if (mode === 'practice') {
        gameSession.betAmount = 0; // Ensure no bet for practice mode
        gameSession.isMultiplayer = false;
        startGame();
    } else {
        showScreen('competitionSetup');
    }
}

async function startCompetition() {
    const betAmount = parseInt(document.getElementById('betAmount').value);
    
    if (!betAmount || betAmount < 1) {
        alert('Please enter a valid bet amount');
        return;
    }

    if (betAmount > currentUser.pomodoro_count) {
        alert('You don\'t have enough coins!');
        return;
    }

    gameSession.betAmount = betAmount;
    gameSession.isMultiplayer = true;
    
    // Create or join multiplayer session
    await createGameSession();
}

// Real-time multiplayer functions
async function createGameSession() {
    try {
        const sessionCode = generateSessionCode();
        const questions = generateQuestions(20); // Generate consistent questions
        
        const { data, error } = await supabase
            .from('game_sessions')
            .insert([{
                session_code: sessionCode,
                creator: currentUser.username,
                bet_amount: gameSession.betAmount,
                questions: questions,
                status: 'waiting'
            }])
            .select()
            .single();

        if (error) throw error;

        currentSession = data;
        gameSession.sessionCode = sessionCode;
        gameSession.questions = questions;
        
        // Join the session as creator
        await joinGameSession(data.id);
        
        // Show waiting screen
        showWaitingScreen();
        
    } catch (error) {
        alert('Failed to create game session: ' + error.message);
    }
}

async function joinGameSession(sessionId) {
    try {
        // Add user to participants with their bet amount
        const { error } = await supabase
            .from('game_participants')
            .insert([{
                session_id: sessionId,
                username: currentUser.username,
                bet_amount: gameSession.betAmount
            }]);

        if (error) throw error;
        
        // Subscribe to real-time updates
        subscribeToGameUpdates(sessionId);
        
    } catch (error) {
        console.error('Error joining session:', error);
    }
}

function subscribeToGameUpdates(sessionId) {
    // Unsubscribe from any existing subscription
    if (realtimeSubscription) {
        supabase.removeChannel(realtimeSubscription);
    }
    
    // Subscribe to game session updates
    realtimeSubscription = supabase
        .channel(`game-session-${sessionId}`)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'game_sessions',
                filter: `id=eq.${sessionId}`
            },
            handleGameSessionUpdate
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'game_participants',
                filter: `session_id=eq.${sessionId}`
            },
            handleParticipantUpdate
        )
        .subscribe();
}

function handleGameSessionUpdate(payload) {
    const session = payload.new;
    
    if (session.status === 'cancelled') {
        // Game session was cancelled
        alert(`Game session cancelled by ${session.cancelled_by || 'the creator'}`);
        cleanupGameSession();
        showScreen('mainMenu');
        return;
    }
    
    if (session.status === 'active' && currentSession.status === 'waiting') {
        // Game is starting
        currentSession = session;
        gameSession.questions = session.questions;
        startRealtimeGame();
    } else if (session.status === 'finished') {
        // Game ended
        endRealtimeGame();
    }
}

function handleParticipantUpdate(payload) {
    if (payload.eventType === 'INSERT') {
        updateWaitingScreen();
    } else if (payload.eventType === 'DELETE') {
        // Someone left the session
        updateWaitingScreen();
        
        // If you're the creator and this was someone else leaving
        if (currentUser.username === currentSession.creator && 
            payload.old && payload.old.username !== currentUser.username) {
            showNotification(`${payload.old.username} left the session`);
        }
    } else if (payload.eventType === 'UPDATE') {
        updateGameProgress(payload.new);
    }
}

async function startRealtimeGame() {
    // Start the actual game
    gameSession.startTime = Date.now();
    gameSession.timeLeft = 60;
    gameSession.currentQuestionIndex = 0;
    gameSession.correctAnswers = 0;
    gameSession.totalAnswers = 0;
    
    showScreen('gameScreen');
    displayQuestion();
    startTimer();
    document.getElementById('answerInput').focus();
}

// Update submit answer for multiplayer
async function submitAnswer() {
    const userAnswer = parseInt(document.getElementById('answerInput').value);
    const question = gameSession.questions[gameSession.currentQuestionIndex];
    
    if (isNaN(userAnswer)) {
        return;
    }
    
    const isCorrect = userAnswer === question.answer;
    gameSession.totalAnswers++;
    
    if (isCorrect) {
        gameSession.correctAnswers++;
        showFeedback('Correct! ✅', 'correct');
    } else {
        showFeedback(`Wrong! Correct answer: ${question.answer} ❌`, 'incorrect');
    }
    
    // Update database for multiplayer
    if (gameSession.isMultiplayer && currentSession) {
        await updateParticipantProgress();
    }
    
    gameSession.currentQuestionIndex++;
    
    setTimeout(() => {
        if (gameSession.timeLeft > 0) {
            displayQuestion();
        }
    }, 1000);
}

async function updateParticipantProgress() {
    try {
        const { error } = await supabase
            .from('game_participants')
            .update({
                correct_answers: gameSession.correctAnswers,
                total_answers: gameSession.totalAnswers,
                score: calculateScore()
            })
            .eq('session_id', currentSession.id)
            .eq('username', currentUser.username);

        if (error) console.error('Error updating progress:', error);
    } catch (error) {
        console.error('Error updating participant:', error);
    }
}

function generateSessionCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function showWaitingScreen() {
    const isCreator = currentUser.username === currentSession.creator;
    
    const waitingHTML = `
        <div class="card" style="text-align: center;">
            <h2>Waiting for Players</h2>
            <p>Session Code: <strong>${gameSession.sessionCode}</strong></p>
            <p>Share this code with other players!</p>
            <div id="participantsList">Loading...</div>
            
            ${isCreator ? `
                <button class="btn" onclick="startGameForAll()" id="startGameBtn" disabled>
                    Start Game (Need at least 2 players)
                </button>
                <button class="btn btn-danger" onclick="cancelGameSession()" style=": #dc3545; margin-left: 10px;">
                    Cancel Session
                </button>
            ` : `
                <p style="color: #666; font-style: italic;">Waiting for ${currentSession.creator} to start the game...</p>
                <button class="btn btn-danger" onclick="leaveGameSession()" style=": #dc3545;">
                    Leave Session
                </button>
            `}
            
            <button class="btn btn-secondary" onclick="backToMenu()" style="margin-top: 10px;">
                Back to Menu
            </button>
        </div>
    `;
    
    document.getElementById('competitionSetup').innerHTML = waitingHTML;
    updateWaitingScreen();
}

async function updateWaitingScreen() {
    try {
        const { data: participants, error } = await supabase
            .from('game_participants')
            .select('username, bet_amount')
            .eq('session_id', currentSession.id);

        if (error) throw error;

        const participantsList = document.getElementById('participantsList');
        if (participantsList) {
            // Calculate the final bet (minimum among all participants)
            const betAmounts = participants.map(p => p.bet_amount);
            const finalBet = betAmounts.length > 0 ? Math.min(...betAmounts) : currentSession.bet_amount;
            
            let participantsHTML = `
                <h3>Players (${participants.length}):</h3>
                <div style=": #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border: 2px solid #4facfe;">
                    <strong>📊 Final Bet: ${finalBet} coins per player</strong>
                    <p style="font-size: 0.9em; color: #666; margin: 5px 0 0 0;">
                        (Based on the lowest bet among all players)
                    </p>
                </div>
                <div style="text-align: left;">
            `;
            
            participants.forEach(p => {
                const isLowestBet = p.bet_amount === finalBet;
                participantsHTML += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
                        <span>• ${p.username}</span>
                        <span style="color: ${isLowestBet ? '#4caf50' : '#666'}; font-weight: ${isLowestBet ? 'bold' : 'normal'};">
                            ${p.bet_amount} coins ${isLowestBet ? '(Final Bet)' : ''}
                        </span>
                    </div>
                `;
            });
            
            participantsHTML += '</div>';
            participantsList.innerHTML = participantsHTML;
        }

        // Enable start button only for creator with at least 2 players
        const startBtn = document.getElementById('startGameBtn');
        if (startBtn && currentUser.username === currentSession.creator) {
            startBtn.disabled = participants.length < 2;
            if (participants.length >= 2) {
                const finalBet = Math.min(...participants.map(p => p.bet_amount));
                startBtn.textContent = `Start Game (${finalBet} coins per player)`;
            }
        }

    } catch (error) {
        console.error('Error updating waiting screen:', error);
    }
}

async function startGameForAll() {
    if (currentUser.username !== currentSession.creator) {
        alert('Only the creator can start the game');
        return;
    }

    try {
        const { error } = await supabase
            .from('game_sessions')
            .update({ 
                status: 'active',
                start_time: new Date().toISOString()
            })
            .eq('id', currentSession.id);

        if (error) throw error;
    } catch (error) {
        alert('Failed to start game: ' + error.message);
    }
}

// Game logic
function startGame() {
    // Reset game session
    gameSession = {
        questions: generateQuestions(60), // Generate enough questions for 60 seconds
        currentQuestionIndex: 0,
        correctAnswers: 0,
        totalAnswers: 0,
        startTime: Date.now(),
        timeLeft: 60,
        timer: null,
        betAmount: gameMode === 'competition' ? gameSession.betAmount : 0
    };

    showScreen('gameScreen');
    displayQuestion();
    startTimer();
    document.getElementById('answerInput').focus();
}

function generateQuestions(count) {
    const questions = [];
    
    for (let i = 0; i < count; i++) {
        const isAddition = Math.random() > 0.5;
        let num1, num2;
        
        if (isAddition) {
            // Addition: ensure result doesn't exceed 5 digits
            num1 = Math.floor(Math.random() * 50000) + 1;
            num2 = Math.floor(Math.random() * (99999 - num1)) + 1;
        } else {
            // Subtraction: ensure positive result
            num1 = Math.floor(Math.random() * 99999) + 1;
            num2 = Math.floor(Math.random() * num1) + 1;
        }
        
        const question = isAddition ? 
            { text: `${num1} + ${num2}`, answer: num1 + num2 } :
            { text: `${num1} - ${num2}`, answer: num1 - num2 };
            
        questions.push(question);
    }
    
    return questions;
}

function displayQuestion() {
    if (gameSession.currentQuestionIndex < gameSession.questions.length) {
        const question = gameSession.questions[gameSession.currentQuestionIndex];
        document.getElementById('question').textContent = question.text;
        document.getElementById('answerInput').value = '';
        document.getElementById('questionFeedback').classList.add('hidden');
        document.getElementById('answerInput').focus();
    }
    updateStats();
}

function updateStats() {
    document.getElementById('correctCount').textContent = gameSession.correctAnswers;
    document.getElementById('totalCount').textContent = gameSession.totalAnswers;
    const accuracy = gameSession.totalAnswers > 0 ? 
        Math.round((gameSession.correctAnswers / gameSession.totalAnswers) * 100) : 0;
    document.getElementById('accuracy').textContent = accuracy + '%';
}

function startTimer() {
    gameSession.timer = setInterval(() => {
        gameSession.timeLeft--;
        document.getElementById('timer').textContent = gameSession.timeLeft;
        
        if (gameSession.timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

function handleEnter(event) {
    if (event.key === 'Enter') {
        submitAnswer();
    }
}

function submitAnswer() {
    const userAnswer = parseInt(document.getElementById('answerInput').value);
    const question = gameSession.questions[gameSession.currentQuestionIndex];
    
    if (isNaN(userAnswer)) {
        return;
    }
    
    const isCorrect = userAnswer === question.answer;
    gameSession.totalAnswers++;
    
    if (isCorrect) {
        gameSession.correctAnswers++;
        showFeedback('Correct! ✅', 'correct');
    } else {
        showFeedback(`Wrong! Correct answer: ${question.answer} ❌`, 'incorrect');
    }
    
    gameSession.currentQuestionIndex++;
    
    setTimeout(() => {
        displayQuestion();
    }, 1000);
}

function showFeedback(message, className) {
    const feedback = document.getElementById('questionFeedback');
    feedback.textContent = message;
    feedback.className = `question-feedback ${className}`;
    feedback.classList.remove('hidden');
}

async function endGame() {
    if (gameSession.timer) {
        clearInterval(gameSession.timer);
    }
    
    const score = calculateScore();
    const accuracy = gameSession.totalAnswers > 0 ? 
        Math.round((gameSession.correctAnswers / gameSession.totalAnswers) * 100) : 0;
    
    // Save game result to database
    await saveGameResult(score, accuracy);
    
    // Handle competition mode
    if (gameMode === 'competition') {
        await handleCompetitionResult(score);
    }
    
    // Show results
    document.getElementById('finalCorrect').textContent = gameSession.correctAnswers;
    document.getElementById('finalTotal').textContent = gameSession.totalAnswers;
    document.getElementById('finalAccuracy').textContent = accuracy + '%';
    document.getElementById('finalScore').textContent = score;
    
    showScreen('resultsScreen');
}

function calculateScore() {
    if (gameSession.totalAnswers === 0) return 0;
    const accuracy = gameSession.correctAnswers / gameSession.totalAnswers;
    return Math.round(gameSession.correctAnswers * accuracy * 100);
}

async function saveGameResult(score, accuracy) {
    try {
        await supabase
            .from('game_results')
            .insert([
                {
                    username: currentUser.username,
                    correct_answers: gameSession.correctAnswers,
                    total_answers: gameSession.totalAnswers,
                    accuracy: accuracy,
                    score: score,
                    game_mode: gameMode,
                    created_at: new Date().toISOString()
                }
            ]);
    } catch (error) {
        console.error('Error saving game result:', error);
    }
}

async function handleCompetitionResult(score) {
    // Only handle currency changes for actual competition mode, not practice
    if (gameMode !== 'competition' || gameSession.betAmount === 0) {
        return;
    }
    
    try {
        const betAmount = gameSession.betAmount;
        
        // For single-player competition mode, 
        // win condition: score > 500 (you can adjust this)
        const isWinner = score > 500;
        
        if (isWinner) {
            // Winner gets bonus coins
            const bonusCoins = Math.floor(betAmount * 0.5);
            await supabase
                .from('users_v3')
                .update({ 
                    pomodoro_count: currentUser.pomodoro_count + bonusCoins 
                })
                .eq('username', currentUser.username);
            
            currentUser.pomodoro_count += bonusCoins;
            document.getElementById('competitionResult').innerHTML = 
                `<div class="success">🎉 You won! Earned ${bonusCoins} bonus coins!</div>`;
        } else {
            // Loser loses bet amount
            await supabase
                .from('users_v3')
                .update({ 
                    pomodoro_count: Math.max(0, currentUser.pomodoro_count - betAmount) 
                })
                .eq('username', currentUser.username);
            
            currentUser.pomodoro_count = Math.max(0, currentUser.pomodoro_count - betAmount);
            document.getElementById('competitionResult').innerHTML = 
                `<div class="error">😔 You lost ${betAmount} coins. Better luck next time!</div>`;
        }
        
        document.getElementById('userCurrency').textContent = currentUser.pomodoro_count;
        document.getElementById('competitionResult').classList.remove('hidden');
        
    } catch (error) {
        console.error('Error handling competition result:', error);
    }
}

// Leaderboard functions
async function showLeaderboard() {
    showScreen('leaderboardScreen');
    await refreshLeaderboard();
}

async function refreshLeaderboard() {
    try {
        document.getElementById('leaderboardContent').innerHTML = 'Loading...';
        
        // Get all results, newest first (optional, but useful if scores tie)
        const { data: results, error } = await supabase
            .from('game_results')
            .select('*')
            .order('score', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) {
            document.getElementById('leaderboardContent').innerHTML = 'Error loading leaderboard';
            console.error('Error loading leaderboard:', error);
            return;
        }

        // Keep only highest score per player
        const highestScores = {};
        results.forEach(result => {
            if (!highestScores[result.username]) {
                highestScores[result.username] = result; // first one is highest due to order
            }
        });

        const filteredResults = Object.values(highestScores);

        // Build leaderboard array
        const leaderboard = filteredResults.map(result => {
            const accuracy = result.total_answers > 0 
                ? (result.correct_answers / result.total_answers) 
                : 0;
            const weightedScore = Math.round(
                result.correct_answers * accuracy * 10 + result.score
            );

            return {
                username: result.username,
                totalCorrect: result.correct_answers,
                totalAnswers: result.total_answers,
                accuracy: Math.round(accuracy * 100),
                avgScore: result.score, // highest score game
                weightedScore
            };
        });

        // Sort by weighted score
        leaderboard.sort((a, b) => b.weightedScore - a.weightedScore);

        // Render leaderboard
        let html = '';
        leaderboard.forEach((player, index) => {
            html += `
                <div class="leaderboard-item">
                    <span class="leaderboard-rank">#${index + 1}</span>
                    <span class="leaderboard-name">${player.username}</span>
                    <div class="leaderboard-stats">
                        <div>Score: ${player.weightedScore}</div>
                        <div>${player.totalCorrect} correct | ${player.accuracy}% accuracy</div>
                    </div>
                </div>
            `;
        });

        document.getElementById('leaderboardContent').innerHTML =
            html || '<div style="text-align: center; color: #666;">No games played yet</div>';

    } catch (error) {
        document.getElementById('leaderboardContent').innerHTML = 'Error loading leaderboard';
        console.error('Error loading leaderboard:', error);
    }
}

async function endGame() {
    if (gameSession.timer) {
        clearInterval(gameSession.timer);
    }
    
    const score = calculateScore();
    const accuracy = gameSession.totalAnswers > 0 ? 
        Math.round((gameSession.correctAnswers / gameSession.totalAnswers) * 100) : 0;
    
    // Save game result to database
    await saveGameResult(score, accuracy);
    
    // Handle multiplayer ending
    if (gameSession.isMultiplayer && currentSession) {
        await finishMultiplayerGame();
    } else if (gameMode === 'competition') {
        // Handle single-player competition
        await handleCompetitionResult(score);
    }
    
    // Show results
    document.getElementById('finalCorrect').textContent = gameSession.correctAnswers;
    document.getElementById('finalTotal').textContent = gameSession.totalAnswers;
    document.getElementById('finalAccuracy').textContent = accuracy + '%';
    document.getElementById('finalScore').textContent = score;
    
    showScreen('resultsScreen');
}

async function finishMultiplayerGame() {
    try {
        // Mark participant as finished
        await supabase
            .from('game_participants')
            .update({
                finished_at: new Date().toISOString(),
                score: calculateScore()
            })
            .eq('session_id', currentSession.id)
            .eq('username', currentUser.username);

        // Check if all players finished
        const { data: participants } = await supabase
            .from('game_participants')
            .select('*')
            .eq('session_id', currentSession.id);

        const allFinished = participants.every(p => p.finished_at);
        
        if (allFinished) {
            // End the session and calculate winners
            await supabase
                .from('game_sessions')
                .update({ status: 'finished' })
                .eq('id', currentSession.id);
                
            await handleMultiplayerResults(participants);
        }
        
    } catch (error) {
        console.error('Error finishing multiplayer game:', error);
    }
}

async function handleMultiplayerResults(participants) {
    try {
        // Get all participants' bet amounts from the database
        const { data: sessionParticipants, error } = await supabase
            .from('game_participants')
            .select('username, bet_amount')
            .eq('session_id', currentSession.id);
            
        if (error) throw error;
        
        // Find the lowest bet amount among all participants
        const betAmounts = sessionParticipants.map(p => p.bet_amount);
        const finalBetAmount = Math.min(...betAmounts);
        
        console.log(`Final bet amount (lowest): ${finalBetAmount} coins`);
        
        // Sort by score to determine winner
        participants.sort((a, b) => b.score - a.score);
        const winner = participants[0];
        const loserCount = participants.length - 1;
        const totalWinnings = finalBetAmount * loserCount; // Winner gets all losers' bets
        
        // Update currencies for all participants
        for (const participant of participants) {
            const { data: user } = await supabase
                .from('users_v3')
                .select('pomodoro_count')
                .eq('username', participant.username)
                .single();
                
            let newAmount;
            if (participant.username === winner.username) {
                // Winner gets total winnings (doesn't lose their own bet)
                newAmount = user.pomodoro_count + totalWinnings;
            } else {
                // Losers lose the final bet amount (not their original bet)
                newAmount = Math.max(0, user.pomodoro_count - finalBetAmount);
            }
            
            await supabase
                .from('users_v3')
                .update({ pomodoro_count: newAmount })
                .eq('username', participant.username);
        }
        
        // Show results based on whether current user won or lost
        if (currentUser.username === winner.username) {
            document.getElementById('competitionResult').innerHTML = 
                `<div class="success">🎉 You won! Earned ${totalWinnings} coins! (Final bet was ${finalBetAmount} coins per player)</div>`;
        } else {
            document.getElementById('competitionResult').innerHTML = 
                `<div class="error">😔 You lost ${finalBetAmount} coins. Winner: ${winner.username} (Final bet was ${finalBetAmount} coins per player)</div>`;
        }
        
        // Update displayed currency for current user
        const { data: updatedUser } = await supabase
            .from('users_v3')
            .select('pomodoro_count')
            .eq('username', currentUser.username)
            .single();
            
        currentUser.pomodoro_count = updatedUser.pomodoro_count;
        document.getElementById('userCurrency').textContent = currentUser.pomodoro_count;
        document.getElementById('competitionResult').classList.remove('hidden');
        
    } catch (error) {
        console.error('Error handling multiplayer results:', error);
    }
}

// Add function to join existing session
async function joinSessionByCode() {
    const code = prompt('Enter session code:');
    if (!code) return;
    
    try {
        const { data: session, error } = await supabase
            .from('game_sessions')
            .select('*')
            .eq('session_code', code.toUpperCase())
            .eq('status', 'waiting')
            .single();
            
        if (error || !session) {
            alert('Session not found or already started');
            return;
        }
        
        // Ask for bet amount
        const betAmount = parseInt(prompt(`Enter your bet amount (coins):\n\nNote: The final bet will be the lowest amount among all players.`));
        
        if (!betAmount || betAmount < 1) {
            alert('Please enter a valid bet amount');
            return;
        }
        
        // Check if user has enough coins
        if (betAmount > currentUser.pomodoro_count) {
            alert('You don\'t have enough coins!');
            return;
        }
        
        currentSession = session;
        gameSession.betAmount = betAmount; // Store user's bet amount
        gameSession.sessionCode = session.session_code;
        gameSession.questions = session.questions;
        gameSession.isMultiplayer = true;
        
        await joinGameSession(session.id);
        showWaitingScreen();
        
    } catch (error) {
        alert('Error joining session: ' + error.message);
    }
}

// Navigation functions
function backToMenu() {
    if (currentSession && currentSession.status === 'waiting') {
        // If in a waiting session, ask for confirmation
        const isCreator = currentUser.username === currentSession.creator;
        const message = isCreator 
            ? 'Leaving will cancel the session for all players. Continue?' 
            : 'Are you sure you want to leave this session?';
            
        if (confirm(message)) {
            if (isCreator) {
                cancelGameSession();
            } else {
                leaveGameSession();
            }
        }
        return;
    }
    
    // Clean up any existing session data
    cleanupGameSession();
    showScreen('mainMenu');
}


// Cancel game session (for creators)
async function cancelGameSession() {
    if (!currentSession || currentUser.username !== currentSession.creator) {
        alert('Only the session creator can cancel the game');
        return;
    }
    
    if (!confirm('Are you sure you want to cancel this game session? All participants will be notified.')) {
        return;
    }
    
    try {
        // Update session status to cancelled
        const { error: sessionError } = await supabase
            .from('game_sessions')
            .update({ 
                status: 'cancelled',
                cancelled_at: new Date().toISOString(),
                cancelled_by: currentUser.username
            })
            .eq('id', currentSession.id);
            
        if (sessionError) throw sessionError;
        
        // Notify all participants via real-time update
        // (This will trigger the handleGameSessionUpdate function for all subscribed clients)
        
        // Clean up and return to menu
        await cleanupGameSession();
        alert('Game session cancelled successfully');
        showScreen('mainMenu');
        
    } catch (error) {
        console.error('Error cancelling session:', error);
        alert('Failed to cancel session: ' + error.message);
    }
}

// Leave game session (for participants)
async function leaveGameSession() {
    if (!currentSession) return;
    
    const isCreator = currentUser.username === currentSession.creator;
    const confirmMessage = isCreator 
        ? 'As the creator, leaving will cancel the entire session. Continue?' 
        : 'Are you sure you want to leave this game session?';
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        if (isCreator) {
            // If creator leaves, cancel the entire session
            await cancelGameSession();
            return;
        }
        
        // Remove participant from the session
        const { error } = await supabase
            .from('game_participants')
            .delete()
            .eq('session_id', currentSession.id)
            .eq('username', currentUser.username);
            
        if (error) throw error;
        
        // Clean up and return to menu
        await cleanupGameSession();
        alert('Left game session successfully');
        showScreen('mainMenu');
        
    } catch (error) {
        console.error('Error leaving session:', error);
        alert('Failed to leave session: ' + error.message);
    }
}

// Clean up game session data and subscriptions
async function cleanupGameSession() {
    // Unsubscribe from real-time updates
    if (realtimeSubscription) {
        supabase.removeChannel(realtimeSubscription);
        realtimeSubscription = null;
    }
    
    // Reset session data
    currentSession = null;
    gameSession.sessionCode = null;
    gameSession.isMultiplayer = false;
    gameSession.betAmount = 0;
}

// Utility function to show temporary notifications
function showNotification(message) {
    // Create a temporary notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4facfe;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
        style.remove();
    }, 3000);
}

if (!document.querySelector('#cancel-session-styles')) {
    const styleElement = document.createElement('div');
    styleElement.id = 'cancel-session-styles';
    styleElement.innerHTML = additionalCSS;
    document.head.appendChild(styleElement);
}

const additionalCSS = `
<style>
.btn-danger {
    background: #dc3545 !important;
    border-color: #dc3545 !important;
}

.btn-danger:hover {
    background: #c82333 !important;
    border-color: #bd2130 !important;
}

.btn-danger:disabled {
    background: #6c757d !important;
    border-color: #6c757d !important;
    cursor: not-allowed;
}
</style>
`;
