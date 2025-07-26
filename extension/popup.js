// Popup JavaScript
let chatHistory = [];
let currentVideoId = null;

// DOM elements
const videoInfo = document.getElementById('videoInfo');
const videoIdElement = document.getElementById('videoId');
const statusElement = document.getElementById('status');
const chatMessages = document.getElementById('chatMessages');
const questionInput = document.getElementById('questionInput');
const sendButton = document.getElementById('sendButton');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    await loadCurrentVideo();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    sendButton.addEventListener('click', sendMessage);
    
    questionInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    questionInput.addEventListener('input', () => {
        sendButton.disabled = !questionInput.value.trim();
    });
}

// Load current video data
async function loadCurrentVideo() {
    try {
        // First try to get from storage
        const result = await chrome.storage.local.get('currentVideo');
        
        if (result.currentVideo) {
            displayVideoInfo(result.currentVideo);
            return;
        }
        
        // If not in storage, try to get from current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab.url && tab.url.includes('youtube.com/watch')) {
            chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_VIDEO' }, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus('Please refresh the YouTube page and try again.', 'error');
                    return;
                }
                
                if (response && response.success) {
                    const videoData = {
                        videoId: response.videoId,
                        videoTitle: response.videoTitle,
                        url: response.url
                    };
                    displayVideoInfo(videoData);
                } else {
                    showStatus('No YouTube video detected. Go to a video page.', 'error');
                }
            });
        } else {
            showStatus('Please navigate to a YouTube video first.', 'error');
        }
    } catch (error) {
        showStatus('Error loading video data: ' + error.message, 'error');
    }
}

// Display video information
function displayVideoInfo(videoData) {
    currentVideoId = videoData.videoId;
    videoIdElement.textContent = videoData.videoId;
    videoInfo.style.display = 'block';
    
    // Enable chat interface
    questionInput.disabled = false;
    questionInput.placeholder = 'Ask about this video...';
    
    showStatus('Video loaded! Ready to chat.', 'success');
    
    // Clear previous messages for new video
    chatHistory = [];
    updateChatDisplay();
}

// Show status message
function showStatus(message, type) {
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    }
}

// Send message
async function sendMessage() {
    const question = questionInput.value.trim();
    if (!question || !currentVideoId) return;
    
    // Add user message to chat
    addMessage(question, 'user');
    questionInput.value = '';
    sendButton.disabled = true;
    
    // Show loading
    const loadingMessage = addMessage('Thinking<span class="loading-dots"></span>', 'bot', true);
    
    try {
        // Send to background script
        chrome.runtime.sendMessage({
            type: 'CHAT_MESSAGE',
            message: question,
            videoId: currentVideoId
        }, (response) => {
            // Remove loading message
            loadingMessage.remove();
            
            if (response && response.success) {
                addMessage(response.response, 'bot');
            } else {
                addMessage('Sorry, I encountered an error: ' + (response?.error || 'Unknown error'), 'bot');
            }
            
            questionInput.disabled = false;
            questionInput.focus();
        });
        
    } catch (error) {
        loadingMessage.remove();
        addMessage('Error: ' + error.message, 'bot');
        questionInput.disabled = false;
    }
}

// Add message to chat
function addMessage(content, type, isHtml = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    if (isHtml) {
        messageDiv.innerHTML = content;
    } else {
        messageDiv.textContent = content;
    }
    
    // Remove empty state message if it exists
    const emptyState = chatMessages.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Store in history (except loading messages)
    if (!isHtml) {
        chatHistory.push({ content, type, timestamp: Date.now() });
    }
    
    return messageDiv;
}

// Update chat display
function updateChatDisplay() {
    chatMessages.innerHTML = '';
    
    if (chatHistory.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'Ask questions about this video!';
        chatMessages.appendChild(emptyState);
    } else {
        chatHistory.forEach(msg => {
            addMessage(msg.content, msg.type);
        });
    }
}