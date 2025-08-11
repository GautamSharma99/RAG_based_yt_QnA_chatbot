// Background service worker
let currentVideoData = null;
const BACKEND_URL = 'http://localhost:5000'; // Your Flask server URL

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'VIDEO_DETECTED':
            currentVideoData = {
                videoId: request.videoId,
                videoTitle: request.videoTitle,
                url: request.url,
                timestamp: Date.now()
            };
            
            // Store in chrome storage for persistence
            chrome.storage.local.set({
                currentVideo: currentVideoData
            });
            
            // Process video with backend when detected
            processVideoWithBackend(currentVideoData);
            
            // Update extension badge
            chrome.action.setBadgeText({
                text: '●',
                tabId: sender.tab.id
            });
            chrome.action.setBadgeBackgroundColor({
                color: '#4CAF50'
            });
            
            console.log('Background: Video detected', currentVideoData);
            break;
            
        case 'VIDEO_REMOVED':
            currentVideoData = null;
            chrome.storage.local.remove('currentVideo');
            
            // Clear badge
            if (sender.tab) {
                chrome.action.setBadgeText({
                    text: '',
                    tabId: sender.tab.id
                });
            }
            break;
            
        case 'GET_VIDEO_DATA':
            sendResponse(currentVideoData);
            break;
            
        case 'CHAT_MESSAGE':
            handleChatMessage(request, sendResponse);
            return true; // Will respond asynchronously
    }
});

// Process video with backend when detected
async function processVideoWithBackend(videoData) {
    try {
        const response = await fetch(`${BACKEND_URL}/process_video`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                video_url: videoData.url
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Video processed successfully:', result);
        
        // Update stored video data with processing status
        const updatedVideoData = {
            ...videoData,
            processed: true,
            processing_result: result
        };
        
        chrome.storage.local.set({
            currentVideo: updatedVideoData
        });
        
    } catch (error) {
        console.error('Error processing video with backend:', error);
        
        // Update stored video data with error status
        const updatedVideoData = {
            ...videoData,
            processed: false,
            processing_error: error.message
        };
        
        chrome.storage.local.set({
            currentVideo: updatedVideoData
        });
    }
}

// background.js

async function handleChatMessage(request, sendResponse) {
    try {
        const result = await chrome.storage.local.get('currentVideo');
        const videoData = result.currentVideo;

        if (!videoData) {
            sendResponse({
                success: false,
                error: 'No video detected. Please go to a YouTube video first.'
            });
            return;
        }

        const response = await fetch('http://127.0.0.1:5000/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                video_id: videoData.videoId,
                question: request.message,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();

        sendResponse({
            success: true,
            response: responseData.response,
            videoId: videoData.videoId
        });

    } catch (error) {
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

// Health check function to verify backend is running
async function checkBackendHealth() {
    try {
        const response = await fetch(`${BACKEND_URL}/health`);
        return response.ok;
    } catch (error) {
        console.error('Backend health check failed:', error);
        return false;
    }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async () => {
    console.log('YouTube Chatbot extension installed');
    
    // Check if backend is running
    const isBackendHealthy = await checkBackendHealth();
    if (!isBackendHealthy) {
        console.warn('Backend server is not running. Please start your Flask server on http://localhost:5000');
    } else {
        console.log('Backend server is running and healthy');
    }
});

// Handle tab updates to manage badge
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        if (!tab.url.includes('youtube.com/watch')) {
            chrome.action.setBadgeText({
                text: '',
                tabId: tabId
            });
        }
    }
});