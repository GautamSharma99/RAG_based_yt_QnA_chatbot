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
    
    // Check processing status
    if (videoData.processed === true) {
        // Video is processed and ready
        questionInput.disabled = false;
        questionInput.placeholder = 'Ask about this video...';
        showStatus('Video processed! Ready to chat.', 'success');
        
    } else if (videoData.processed === false && videoData.processing_error) {
        // Video processing failed
        questionInput.disabled = true;
        questionInput.placeholder = 'Video processing failed...';
        showStatus(`Processing failed: ${videoData.processing_error}`, 'error');
        
    } else {
        // Video is being processed or status unknown
        questionInput.disabled = true;
        questionInput.placeholder = 'Processing video...';
        showStatus('Processing video transcript... Please wait.', 'loading');
        
        // Check status periodically
        checkProcessingStatus();
    }
    
    // Clear previous messages for new video
    chatHistory = [];
    updateChatDisplay();
}

// Check processing status periodically
function checkProcessingStatus() {
    const checkInterval = setInterval(async () => {
        try {
            const result = await chrome.storage.local.get('currentVideo');
            const videoData = result.currentVideo;
            
            if (!videoData || videoData.videoId !== currentVideoId) {
                clearInterval(checkInterval);
                return;
            }
            
            if (videoData.processed === true) {
                clearInterval(checkInterval);
                questionInput.disabled = false;
                questionInput.placeholder = 'Ask about this video...';
                showStatus('Video processed! Ready to chat.', 'success');
                
            } else if (videoData.processed === false && videoData.processing_error) {
                clearInterval(checkInterval);
                questionInput.disabled = true;
                questionInput.placeholder = 'Video processing failed...';
                showStatus(`Processing failed: ${videoData.processing_error}`, 'error');
            }
            
        } catch (error) {
            console.error('Error checking processing status:', error);
        }
    }, 2000); // Check every 2 seconds
    
    // Stop checking after 60 seconds
    setTimeout(() => {
        clearInterval(checkInterval);
        if (questionInput.disabled) {
            showStatus('Processing timeout. Please refresh and try again.', 'error');
        }
    }, 60000);
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
                const errorMsg = response?.error || 'Unknown error occurred';
                addMessage(`Sorry, I encountered an error: ${errorMsg}`, 'bot');
                
                // If backend is not running, show helpful message
                if (errorMsg.includes('Failed to fetch') || errorMsg.includes('HTTP error')) {
                    addMessage('Make sure your Flask server is running on http://localhost:5000', 'bot');
                }
            }
            
            questionInput.disabled = false;
            sendButton.disabled = false;
            questionInput.focus();
        });
        
    } catch (error) {
        loadingMessage.remove();
        addMessage('Error: ' + error.message, 'bot');
        questionInput.disabled = false;
        sendButton.disabled = false;
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