// Content script that runs on YouTube pages
let currentVideoId = null;
let isProcessing = false;

// Function to extract video ID from URL
function extractVideoId() {
    const url = window.location.href;
    const videoIdMatch = url.match(/[?&]v=([^&]+)/);
    return videoIdMatch ? videoIdMatch[1] : null;
}

// Function to get video title
function getVideoTitle() {
    const titleElement = document.querySelector('h1.title yt-formatted-string') || 
                         document.querySelector('#title h1') ||
                         document.querySelector('.title');
    return titleElement ? titleElement.textContent.trim() : 'Unknown Video';
}

// Function to check if we're on a video page
function isVideoPage() {
    return window.location.pathname === '/watch';
}

// Function to send video info to extension
function sendVideoInfo(videoId) {
    if (videoId && videoId !== currentVideoId) {
        currentVideoId = videoId;
        const videoTitle = getVideoTitle();
        
        // Send to background script
        chrome.runtime.sendMessage({
            type: 'VIDEO_DETECTED',
            videoId: videoId,
            videoTitle: videoTitle,
            url: window.location.href
        });
        
        console.log('YouTube Chatbot: Video detected -', videoId);
    }
}

// Function to handle URL changes (for SPA navigation)
function handleUrlChange() {
    if (isVideoPage()) {
        // Wait for page content to load
        setTimeout(() => {
            const videoId = extractVideoId();
            if (videoId) {
                sendVideoInfo(videoId);
            }
        }, 1000);
    } else {
        currentVideoId = null;
        chrome.runtime.sendMessage({
            type: 'VIDEO_REMOVED'
        });
    }
}

// Listen for URL changes (YouTube is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        handleUrlChange();
    }
}).observe(document, { subtree: true, childList: true });

// Initial check
handleUrlChange();

// Listen for messages from popup
// content.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_CURRENT_VIDEO') {
        const videoId = extractVideoId();
        if (videoId && isVideoPage()) {
            sendResponse({
                success: true,
                videoId: videoId,
                videoTitle: getVideoTitle(),
                url: window.location.href
            });
        } else {
            sendResponse({
                success: false,
                error: 'No video detected'
            });
        }
    }

    if (request.type === 'PROCESS_VIDEO') {
        if (isProcessing) {
            sendResponse({
                success: false,
                error: 'Already processing a video'
            });
            return true;
        }

        isProcessing = true;
        const videoId = extractVideoId();

        fetch('http://127.0.0.1:5000/process-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                video_id: videoId
            }),
        })
        .then(response => response.json())
        .then(data => {
            isProcessing = false;
            sendResponse(data);
        })
        .catch(error => {
            isProcessing = false;
            sendResponse({ success: false, error: error.toString() });
        });

        return true; // Indicates we will send a response asynchronously
    }
});

// Inject a script to access YouTube's internal API if needed
function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
}

// Only inject if we're on YouTube
if (window.location.hostname === 'www.youtube.com') {
    injectScript();
}