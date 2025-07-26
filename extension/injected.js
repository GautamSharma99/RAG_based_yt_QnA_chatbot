// Injected script to access YouTube's internal APIs
// This script runs in the page context and can access YouTube's internal state

(function() {
    'use strict';
    
    // Function to get video data from YouTube's internal API
    function getYouTubeVideoData() {
        try {
            // Try to get data from YouTube's player
            if (window.ytplayer && window.ytplayer.config) {
                const config = window.ytplayer.config;
                return {
                    videoId: config.args?.video_id,
                    title: config.args?.title,
                    duration: config.args?.length_seconds
                };
            }
            
            // Try alternative method
            if (window.ytInitialData) {
                const videoDetails = window.ytInitialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer;
                if (videoDetails) {
                    return {
                        title: videoDetails.title?.runs?.[0]?.text,
                        viewCount: videoDetails.viewCount?.videoViewCountRenderer?.viewCount?.simpleText
                    };
                }
            }
            
            // Try getting from URL as fallback
            const urlParams = new URLSearchParams(window.location.search);
            const videoId = urlParams.get('v');
            if (videoId) {
                return { videoId };
            }
            
        } catch (error) {
            console.error('Error getting YouTube video data:', error);
        }
        
        return null;
    }
    
    // Function to detect video changes
    let currentVideoId = null;
    
    function checkForVideoChange() {
        const videoData = getYouTubeVideoData();
        if (videoData && videoData.videoId && videoData.videoId !== currentVideoId) {
            currentVideoId = videoData.videoId;
            
            // Send message to content script
            window.postMessage({
                type: 'YOUTUBE_VIDEO_CHANGE',
                videoData: videoData
            }, '*');
        }
    }
    
    // Listen for YouTube's navigation events
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(checkForVideoChange, 1000); // Wait for page to load
        }
    });
    
    observer.observe(document, { subtree: true, childList: true });
    
    // Initial check
    setTimeout(checkForVideoChange, 2000);
    
    // Also check periodically in case we missed something
    setInterval(checkForVideoChange, 5000);
    
    // Listen for messages from content script
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        
        if (event.data.type === 'GET_YOUTUBE_DATA') {
            const videoData = getYouTubeVideoData();
            window.postMessage({
                type: 'YOUTUBE_DATA_RESPONSE',
                videoData: videoData
            }, '*');
        }
    });
    
})();