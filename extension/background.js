// Background service worker
let currentVideoData = null;

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

// Handle chat messages and communicate with your backend
async function handleChatMessage(request, sendResponse) {
    try {
        // Get current video data
        const result = await chrome.storage.local.get('currentVideo');
        const videoData = result.currentVideo;
        
        if (!videoData) {
            sendResponse({
                success: false,
                error: 'No video detected. Please go to a YouTube video first.'
            });
            return;
        }
        
        // Here you would make an API call to your backend
        // For now, we'll simulate the response
        const response = await simulateBackendCall(videoData.videoId, request.message);
        
        sendResponse({
            success: true,
            response: response,
            videoId: videoData.videoId
        });
        
    } catch (error) {
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

// Simulate backend API call (replace with your actual API)
async function simulateBackendCall(videoId, question) {
    // This is where you'd integrate with your existing Python backend
    // You could either:
    // 1. Create a simple Flask/FastAPI server to handle requests
    // 2. Use a cloud function (AWS Lambda, Google Cloud Functions, etc.)
    // 3. Use a service like Vercel or Netlify Functions
    
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`This is a simulated response for video ${videoId} about: ${question}. In your implementation, this would be the actual AI response from your RAG system.`);
        }, 1500);
    });
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('YouTube Chatbot extension installed');
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