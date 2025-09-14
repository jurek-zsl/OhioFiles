document.addEventListener('DOMContentLoaded', () => {
    // Initialize notification system
    initializeNotifications();
    
    const uploadTab = document.getElementById('upload-tab');
    const historyTab = document.getElementById('history-tab');
    const settingsTab = document.getElementById('settings-tab');
    const uploadSection = document.getElementById('upload-section');
    const historySection = document.getElementById('history-section');
    const settingsSection = document.getElementById('settings-section');
    const uploadForm = document.getElementById('upload-form');
    const uploadResult = document.getElementById('upload-result');
    const historyCards = document.getElementById('history-cards');
    const themeSelect = document.getElementById('theme-select');
    const diskSpaceInfo = document.getElementById('disk-space-info');

    // Add progress bar element
    const progressBarContainer = document.createElement('div');
    progressBarContainer.className = 'progress-container hidden';
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBarContainer.appendChild(progressBar);
    uploadForm.after(progressBarContainer);

    const baseUrl = 'https://ohiofiles.live';

    // Session Management
    let currentSessionKey = '';
    
    // Initialize session management
    function initializeSession() {
        currentSessionKey = localStorage.getItem('sessionKey');
        if (!currentSessionKey) {
            currentSessionKey = generateSessionKey();
            localStorage.setItem('sessionKey', currentSessionKey);
            localStorage.setItem('sessionCreated', new Date().toISOString());
        }
        updateSessionDisplay();
        
        // Auto-sync session files on page load
        loadSessionHistory(currentSessionKey);
    }
    
    // Generate a memorable session key
    function generateSessionKey() {
        const adjectives = [
            'Happy', 'Crazy', 'Funny', 'Wild', 'Cool', 'Smart', 'Fast', 'Brave', 'Sweet', 'Loud',
            'Quiet', 'Bright', 'Dark', 'Sharp', 'Smooth', 'Rough', 'Hot', 'Cold', 'Fresh', 'Old',
            'Young', 'Big', 'Small', 'Tall', 'Short', 'Long', 'Quick', 'Slow', 'Strong', 'Weak',
            'Rich', 'Poor', 'Clean', 'Dirty', 'Heavy', 'Light', 'Thick', 'Thin', 'Wide', 'Narrow',
            'Deep', 'Shallow', 'High', 'Low', 'Near', 'Far', 'Early', 'Late', 'Good', 'Bad',
            'Drunk', 'Sober', 'Sleepy', 'Awake', 'Hungry', 'Full', 'Thirsty', 'Sick', 'Healthy', 'Lucky'
        ];
        
        const animals = [
            'Cat', 'Dog', 'Bird', 'Fish', 'Lion', 'Tiger', 'Bear', 'Wolf', 'Fox', 'Rabbit',
            'Mouse', 'Rat', 'Horse', 'Cow', 'Pig', 'Sheep', 'Goat', 'Chicken', 'Duck', 'Turkey',
            'Eagle', 'Hawk', 'Owl', 'Crow', 'Robin', 'Sparrow', 'Parrot', 'Penguin', 'Dolphin', 'Whale',
            'Shark', 'Octopus', 'Crab', 'Lobster', 'Shrimp', 'Turtle', 'Frog', 'Snake', 'Lizard', 'Spider',
            'Bee', 'Ant', 'Butterfly', 'Dragonfly', 'Elephant', 'Giraffe', 'Zebra', 'Rhino', 'Hippo', 'Monkey',
            'Gorilla', 'Panda', 'Koala', 'Kangaroo', 'Sloth', 'Raccoon', 'Squirrel', 'Deer', 'Moose', 'Buffalo'
        ];
        
        const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const animal = animals[Math.floor(Math.random() * animals.length)];
        const number = Math.floor(Math.random() * 999) + 1;
        
        return `${adjective}${animal}${number}`;
    }
    
    // Update session display elements
    function updateSessionDisplay() {
        const currentSessionKeyInput = document.getElementById('current-session-key');
        const sessionFileCount = document.getElementById('session-file-count');
        const sessionCreated = document.getElementById('session-created');
        
        if (currentSessionKeyInput) {
            currentSessionKeyInput.value = currentSessionKey;
        }
        
        // Get session-specific history
        const sessionHistory = getSessionHistory();
        if (sessionFileCount) {
            sessionFileCount.textContent = sessionHistory.length;
        }
        
        const createdDate = localStorage.getItem('sessionCreated');
        if (sessionCreated && createdDate) {
            sessionCreated.textContent = new Date(createdDate).toLocaleDateString();
        }
    }
    
    // Get history for current session
    function getSessionHistory() {
        const allHistory = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
        return allHistory.filter(item => item.sessionKey === currentSessionKey);
    }
    
    // Show session notification
    function showSessionNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `session-notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideInRight 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    // Session management event listeners
    function initializeSessionEvents() {
        // Copy session key
        document.getElementById('copy-session-key')?.addEventListener('click', () => {
            const sessionKeyInput = document.getElementById('current-session-key');
            sessionKeyInput.select();
            document.execCommand('copy');
            showSessionNotification('Session key copied to clipboard!', 'success');
        });
        
        // Generate new session key
        document.getElementById('generate-new-key')?.addEventListener('click', () => {
            if (confirm('Generating a new session key will create a fresh session. Your current upload history will remain but won\'t be synced. Continue?')) {
                currentSessionKey = generateSessionKey();
                localStorage.setItem('sessionKey', currentSessionKey);
                localStorage.setItem('sessionCreated', new Date().toISOString());
                updateSessionDisplay();
                showSessionNotification('New session key generated!', 'success');
            }
        });
        
        // Import session key
        document.getElementById('import-session-btn')?.addEventListener('click', async () => {
            const importInput = document.getElementById('import-session-key');
            const newSessionKey = importInput.value.trim();
            
            if (!newSessionKey) {
                showSessionNotification('Please enter a session key', 'error');
                return;
            }
            
            // Validate session key format (should be alphanumeric and reasonable length)
            if (newSessionKey.length < 5 || newSessionKey.length > 50 || !/^[a-zA-Z0-9]+$/.test(newSessionKey)) {
                showSessionNotification('Invalid session key format', 'error');
                return;
            }
            
            if (confirm('Importing a new session key will replace your current session. Continue?')) {
                // Store old session data
                const oldHistory = getSessionHistory();
                
                // Set new session
                currentSessionKey = newSessionKey;
                localStorage.setItem('sessionKey', currentSessionKey);
                localStorage.setItem('sessionCreated', new Date().toISOString());
                
                // Try to load history from server for this session
                await loadSessionHistory(newSessionKey);
                
                updateSessionDisplay();
                loadHistory(); // Refresh the history display
                importInput.value = '';
                showSessionNotification('Session imported successfully!', 'success');
            }
        });
        
        // Export session
        document.getElementById('export-session')?.addEventListener('click', () => {
            const sessionData = {
                sessionKey: currentSessionKey,
                sessionCreated: localStorage.getItem('sessionCreated'),
                uploadHistory: getSessionHistory(),
                exportDate: new Date().toISOString()
            };
            
            const dataStr = JSON.stringify(sessionData, null, 2);
            const dataBlob = new Blob([dataStr], {type: 'application/json'});
            const url = URL.createObjectURL(dataBlob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `ohiofiles-session-${currentSessionKey.substring(0, 8)}-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            
            URL.revokeObjectURL(url);
            showSessionNotification('Session exported successfully!', 'success');
        });
        
        // Clear session
        document.getElementById('clear-session')?.addEventListener('click', () => {
            if (confirm('This will clear all upload history and create a new session. This action cannot be undone. Continue?')) {
                // Clear session-specific data
                localStorage.removeItem('uploadHistory');
                
                // Generate new session
                currentSessionKey = generateSessionKey();
                localStorage.setItem('sessionKey', currentSessionKey);
                localStorage.setItem('sessionCreated', new Date().toISOString());
                
                // Clear history display
                historyCards.innerHTML = '';
                
                updateSessionDisplay();
                showSessionNotification('Session cleared and new session created!', 'success');
            }
        });
    }
    
    // Load session history (placeholder for future server integration)
    async function loadSessionHistory(sessionKey) {
        try {
            console.log('Loading session history for:', sessionKey);
            
            // Fetch files from server for this session
            const response = await fetch(`/api/session/${sessionKey}/files`);
            console.log('Server response status:', response.status);
            
            if (response.ok) {
                const serverFiles = await response.json();
                console.log('Server files for session:', serverFiles);
                
                if (serverFiles.length === 0) {
                    return;
                }
                
                // Convert server files to our local history format
                const historyItems = serverFiles.map(file => ({
                    fileUrl: `/${file.storedName}`,
                    fileName: file.originalName,
                    uploadDate: file.uploadDate || new Date().toISOString(),
                    size: file.size,
                    isPublic: file.isPublic,
                    sessionKey: sessionKey
                }));
                
                // Get existing history and merge with server data
                const existingHistory = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
                
                // Remove any existing entries for this session to avoid duplicates
                const filteredHistory = existingHistory.filter(item => item.sessionKey !== sessionKey);
                
                // Add the server files
                const mergedHistory = [...filteredHistory, ...historyItems];
                
                // Save merged history
                localStorage.setItem('uploadHistory', JSON.stringify(mergedHistory));
                
                showSessionNotification(`Loaded ${historyItems.length} files from session`, 'success');
            } else {
                const errorText = await response.text();
                console.log('Server error response:', errorText);
            }
        } catch (error) {
            console.error('Error loading session history:', error);
            showSessionNotification('Could not load session files from server', 'warning');
        }
    }
    
    // Sync session files without showing notifications (for auto-sync)
    async function syncSessionFiles() {
        try {
            console.log('Auto-syncing session files for:', currentSessionKey);
            
            // Fetch files from server for this session
            const response = await fetch(`/api/session/${currentSessionKey}/files`);
            
            if (response.ok) {
                const serverFiles = await response.json();
                console.log('Auto-sync found', serverFiles.length, 'files on server');
                
                // Convert server files to our local history format
                const serverHistoryItems = serverFiles.map(file => ({
                    fileUrl: `/${file.storedName}`,
                    fileName: file.originalName,
                    uploadDate: file.uploadDate || new Date().toISOString(),
                    size: file.size,
                    isPublic: file.isPublic,
                    sessionKey: currentSessionKey
                }));
                
                // Get existing history
                const existingHistory = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
                
                // Create sets of file URLs for comparison
                const serverUrls = new Set(serverHistoryItems.map(item => item.fileUrl));
                
                // Find files in local history that belong to the current session
                const sessionFiles = existingHistory.filter(item => item.sessionKey === currentSessionKey);
                const sessionUrls = new Set(sessionFiles.map(item => item.fileUrl));
                
                // Find new files (on server but not in local history)
                const newFiles = serverHistoryItems.filter(item => !sessionUrls.has(item.fileUrl));
                
                // Find deleted files (in local session but not on server)
                const deletedFiles = sessionFiles.filter(item => !serverUrls.has(item.fileUrl));
                
                let historyChanged = false;
                
                // Start with all non-session files (from other sessions)
                let updatedHistory = existingHistory.filter(item => item.sessionKey !== currentSessionKey);
                
                // Add all current server files for this session
                updatedHistory = [...updatedHistory, ...serverHistoryItems];
                
                // Check if there were any changes
                if (newFiles.length > 0 || deletedFiles.length > 0) {
                    historyChanged = true;
                    if (newFiles.length > 0) {
                        console.log(`Auto-synced ${newFiles.length} new files`);
                    }
                    if (deletedFiles.length > 0) {
                        console.log(`Auto-removed ${deletedFiles.length} deleted files`);
                    }
                }
                
                // Update localStorage and UI if there were changes
                if (historyChanged) {
                    localStorage.setItem('uploadHistory', JSON.stringify(updatedHistory));
                    
                    // Update session display
                    updateSessionDisplay();
                    
                    // If we're currently viewing history, refresh it
                    if (!historySection.classList.contains('hidden')) {
                        loadHistory();
                    }
                }
            }
        } catch (error) {
            console.error('Auto-sync failed:', error);
        }
    }
    
    // Initialize session management
    initializeSession();
    initializeSessionEvents();
    
    // Set up periodic sync every 30 seconds
    setInterval(async () => {
        try {
            await syncSessionFiles();
        } catch (error) {
            console.log('Periodic sync failed:', error);
        }
    }, 30000); // 30 seconds
    
    // Sync when page becomes visible (user switches back to tab)
    document.addEventListener('visibilitychange', async () => {
        if (!document.hidden) {
            try {
                await syncSessionFiles();
            } catch (error) {
                console.log('Visibility sync failed:', error);
            }
        }
    });

    // Drag and Drop functionality
    let dragCounter = 0;

    // Function to handle file upload (reusable for both form and drag/drop)
    function handleFileUpload(file, customFilename = '', isPublic = false) {
        console.log('Uploading file:', file.name, 'Size:', file.size, 'Custom filename:', customFilename, 'Public:', isPublic);
        
        // Show progress bar
        progressBarContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        uploadResult.innerHTML = '';

        const formData = new FormData();
        formData.append('file', file);
        if (customFilename) {
            formData.append('customFilename', customFilename);
        }
        formData.append('isPublic', isPublic ? 'true' : 'false');
        formData.append('sessionKey', currentSessionKey);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        // Track upload progress
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
                progressBar.textContent = Math.round(percentComplete) + '%';
            }
        };

        // Handle completion
        xhr.onload = async function () {
            if (xhr.status === 200) {
                const result = JSON.parse(xhr.responseText);
                uploadResult.innerHTML = '<div class="success-message">File uploaded successfully!</div>';
                await updateHistory(result.fileUrl, file.name, isPublic);
                
                // Auto-sync session after upload to ensure other devices see the new file
                try {
                    await syncSessionFiles();
                } catch (error) {
                    console.log('Auto-sync after upload failed:', error);
                }
            } else {
                let errorMsg = 'Upload failed';
                try {
                    const errorObj = JSON.parse(xhr.responseText);
                    errorMsg = errorObj.error || errorMsg;
                } catch (e) {
                    // If response isn't valid JSON
                }
                uploadResult.innerHTML = `<div class="error-message">Error: ${errorMsg}</div>`;
            }
            progressBarContainer.classList.add('hidden');
        };

        xhr.onerror = function () {
            uploadResult.innerHTML = '<div class="error-message">Network error occurred</div>';
            progressBarContainer.classList.add('hidden');
        };

        xhr.send(formData);
    }

    // Drag and drop event listeners
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        document.body.classList.add('drag-over');
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            document.body.classList.remove('drag-over');
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        document.body.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            // Check file size (100MB limit)
            if (file.size > 100 * 1024 * 1024) {
                uploadResult.innerHTML = '<div class="error-message">Error: File size exceeds 100MB limit</div>';
                return;
            }
            
            // Use settings from the form for consistency
            const customFilename = document.getElementById('custom-filename').value.trim();
            const isPublic = document.getElementById('public-checkbox').checked;
            
            handleFileUpload(file, customFilename, isPublic);
        }
    });

    // Clipboard paste functionality
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData.items;
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            // Handle any file type from clipboard, not just images
            if (item.kind === 'file') {
                e.preventDefault();
                const file = item.getAsFile();
                
                if (file) {
                    // Check file size (100MB limit)
                    if (file.size > 100 * 1024 * 1024) {
                        uploadResult.innerHTML = '<div class="error-message">Error: File size exceeds 100MB limit</div>';
                        return;
                    }
                    
                    // Use settings from the form for consistency
                    const customFilename = document.getElementById('custom-filename').value.trim();
                    const isPublic = document.getElementById('public-checkbox').checked;
                    
                    handleFileUpload(file, customFilename, isPublic);
                }
                break;
            }
        }
    });

    // Tab navigation
    uploadTab.addEventListener('click', () => showSection(uploadSection));
    historyTab.addEventListener('click', async () => {
        showSection(historySection);
        // Sync files when user switches to history to ensure up-to-date display
        try {
            await syncSessionFiles();
        } catch (error) {
            console.log('History tab sync failed:', error);
        }
    });
    settingsTab.addEventListener('click', () => showSection(settingsSection));

    function showSection(section) {
        [uploadSection, settingsSection, historySection].forEach(s => s.classList.add('hidden'));
        if (section === settingsSection) {
            [uploadSection, historySection].forEach(s => s.classList.add('hidden'));
            // Update session display when showing settings
            updateSessionDisplay();
        } else {
            [uploadSection, historySection].forEach(s => s.classList.remove('hidden'));
        }
        section.classList.remove('hidden');
        
        // Load history when switching to history tab
        if (section === historySection) {
            loadHistory();
        }
    }

    // Fetch and display disk space
    async function fetchDiskSpace() {
        try {
            // Try with absolute URL with the correct protocol
            const response = await fetch('https://ohiofiles.live/disk-space-api');
            if (!response.ok) {
                // Log the HTTP status and status text if the response is not OK
                console.error(`Error fetching disk space: ${response.status} ${response.statusText}`);
                const errorData = await response.json().catch(() => null);
                if (errorData && errorData.error) {
                    console.error('Server error details:', errorData.error);
                }
                diskSpaceInfo.textContent = 'Space: N/A';
                return;
            }
            const data = await response.json();
            if (data.error) {
                // Handle cases where the server returns a JSON with an error message
                console.error('Server returned an error:', data.error);
                diskSpaceInfo.textContent = 'Space: N/A';
                return;
            }
            const freeSpaceGB = (data.free / (1024 * 1024 * 1024)).toFixed(2);
            const totalSpaceGB = (data.total / (1024 * 1024 * 1024)).toFixed(2);
            diskSpaceInfo.textContent = `Space: ${freeSpaceGB}GB`;
        } catch (error) {
            // This catch block handles network errors or issues with processing the response
            console.error('Error in fetchDiskSpace function:', error);
            diskSpaceInfo.textContent = 'Space left: N/A';
        }
    }

    // File upload
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fileInput = document.getElementById('file-input');
        const customFilenameInput = document.getElementById('custom-filename');
        const publicCheckbox = document.getElementById('public-checkbox');
        const file = fileInput.files[0];
        const customFilename = customFilenameInput.value.trim();
        const isPublic = publicCheckbox.checked;

        if (file) {
            // Check file size (100MB limit)
            if (file.size > 100 * 1024 * 1024) {
                uploadResult.innerHTML = '<div class="error-message">Error: File size exceeds 100MB limit</div>';
                return;
            }
            
            handleFileUpload(file, customFilename, isPublic);
        }
    });

    // Update history
    async function updateHistory(fileUrl, fileName, isPublic = false) {
        try {
            const card = await createHistoryCard(fileUrl, fileName, isPublic);
            if (card && card instanceof HTMLElement) {
                historyCards.appendChild(card);
            } else {
                console.error('createHistoryCard returned invalid element:', card);
                return;
            }
        } catch (error) {
            console.error('Error creating history card:', error);
            return;
        }

        const history = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
        const newItem = { 
            fileUrl, 
            fileName, 
            sessionKey: currentSessionKey,
            uploadDate: new Date().toISOString(),
            isPublic: isPublic
        };
        history.push(newItem);
        localStorage.setItem('uploadHistory', JSON.stringify(history));
        
        // Update session stats
        updateSessionDisplay();
    }

    // Load history from local storage and verify existence
    async function loadHistory() {
        // Clear existing history cards
        historyCards.innerHTML = '';
        
        const history = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
        const verifiedHistory = [];

        // Filter to show only current session files, or all if no session key exists
        const sessionHistory = history.filter(item => 
            !item.sessionKey || item.sessionKey === currentSessionKey
        );

        for (const item of sessionHistory) {
            const response = await fetch(item.fileUrl, { method: 'HEAD' });
            if (response.ok) {
                const card = await createHistoryCard(item.fileUrl, item.fileName, item.isPublic || false);
                historyCards.appendChild(card);
                verifiedHistory.push(item);
            }
        }

        // Only save back verified history for the current session, but preserve other sessions
        const otherSessionHistory = history.filter(item => 
            item.sessionKey && item.sessionKey !== currentSessionKey
        );
        const allVerifiedHistory = [...otherSessionHistory, ...verifiedHistory];
        localStorage.setItem('uploadHistory', JSON.stringify(allVerifiedHistory));
    }

    async function createHistoryCard(fileUrl, fileName, isPublic = false) {
        const card = document.createElement('div');
        card.className = 'history-card';

        // Extract shortId from fileUrl for API calls
        const shortId = fileUrl.split('/').pop().split('.')[0];
        
        // File preview logic with enhanced media support
        const fileExt = fileName.split('.').pop().toLowerCase();
        const previewContainer = document.createElement('div');
        previewContainer.className = 'file-preview';
        previewContainer.style.display = 'flex';
        previewContainer.style.alignItems = 'center';
        previewContainer.style.justifyContent = 'center';
        previewContainer.style.marginRight = '20px';
        
        const fullFileUrl = `${baseUrl}${fileUrl}`;

        // Get file info for enhanced display (with error handling)
        let fileInfo = null;
        try {
            fileInfo = await getFileInfo(shortId);
        } catch (error) {
            console.log('Could not fetch file info:', error);
        }
        
        let mimeType = 'application/octet-stream';
        if (fileInfo && fileInfo.mimeType) {
            mimeType = fileInfo.mimeType;
        }

        // Create optimized media preview
        if (isMediaFile(fileName)) {
            try {
                const mediaElement = createOptimizedMediaElement(fullFileUrl, fileName, mimeType);
                if (mediaElement && mediaElement instanceof HTMLElement) {
                    mediaElement.style.maxWidth = '220px';
                    mediaElement.style.maxHeight = '220px';
                    mediaElement.style.borderRadius = '8px';
                    mediaElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                    previewContainer.appendChild(mediaElement);
                } else {
                    console.error('createOptimizedMediaElement returned invalid element');
                    throw new Error('Invalid media element');
                }
            } catch (error) {
                console.log('Error creating media element:', error);
                // Fallback to icon if media element fails
                const iconDiv = document.createElement('div');
                iconDiv.style.fontSize = '48px';
                iconDiv.style.width = '220px';
                iconDiv.style.height = '120px';
                iconDiv.style.display = 'flex';
                iconDiv.style.alignItems = 'center';
                iconDiv.style.justifyContent = 'center';
                iconDiv.style.background = 'var(--bg-color)';
                iconDiv.style.borderRadius = '8px';
                iconDiv.style.border = '2px dashed var(--primary-color)';
                iconDiv.textContent = getFileIcon(fileName);
                previewContainer.appendChild(iconDiv);
            }
        } else {
            // Show file icon for non-media files
            const iconDiv = document.createElement('div');
            iconDiv.style.fontSize = '48px';
            iconDiv.style.width = '220px';
            iconDiv.style.height = '120px';
            iconDiv.style.display = 'flex';
            iconDiv.style.alignItems = 'center';
            iconDiv.style.justifyContent = 'center';
            iconDiv.style.background = 'var(--bg-color)';
            iconDiv.style.borderRadius = '8px';
            iconDiv.style.border = '2px dashed var(--primary-color)';
            iconDiv.textContent = getFileIcon(fileName);
            previewContainer.appendChild(iconDiv);
        }

        // Card layout: flex row, preview left, info right
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.padding = '16px';
        card.style.marginBottom = '16px';
        card.style.background = 'var(--bg-secondary, #222)';
        card.style.borderRadius = '10px';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)';

        // Info container (right side)
        const infoContainer = document.createElement('div');
        infoContainer.style.flex = '1';
        infoContainer.style.display = 'flex';
        infoContainer.style.flexDirection = 'column';
        infoContainer.style.justifyContent = 'center';
        infoContainer.style.gap = '8px';

        const link = document.createElement('a');
        link.href = fileUrl;
        link.textContent = fileName;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.fontSize = '1.1em';
        link.style.fontWeight = 'bold';
        link.style.wordBreak = 'break-all';

        // Enhanced file info display
        const fileInfoDisplay = document.createElement('div');
        fileInfoDisplay.style.fontSize = '0.85em';
        fileInfoDisplay.style.color = 'var(--text-color)';
        fileInfoDisplay.style.opacity = '0.8';
        
        if (fileInfo) {
            const sizeText = formatFileSize(fileInfo.size);
            const streamingText = fileInfo.supportsRangeRequests ? ' • Streaming ⚡' : '';
            fileInfoDisplay.textContent = `${sizeText}${streamingText}`;
        }

        const linkDisplay = document.createElement('div');
        linkDisplay.style.fontSize = '0.95em';
        linkDisplay.style.wordBreak = 'break-all';
        const linkAnchor = document.createElement('a');
        linkAnchor.href = fullFileUrl;
        linkAnchor.textContent = fullFileUrl;
        linkAnchor.target = '_blank';
        linkAnchor.rel = 'noopener noreferrer';
        linkAnchor.style.wordBreak = 'break-all';
        linkDisplay.textContent = 'Link: ';
        linkDisplay.appendChild(linkAnchor);

        // Add public/private status display
        const statusDisplay = document.createElement('div');
        statusDisplay.style.fontSize = '0.9em';
        statusDisplay.style.margin = '5px 0';
        const statusBadge = document.createElement('span');
        statusBadge.style.padding = '2px 8px';
        statusBadge.style.borderRadius = '12px';
        statusBadge.style.fontSize = '0.8em';
        statusBadge.style.fontWeight = 'bold';
        
        function updateStatusBadge(publicStatus) {
            if (publicStatus) {
                statusBadge.textContent = 'Public';
                statusBadge.style.backgroundColor = '#4CAF50';
                statusBadge.style.color = 'white';
            } else {
                statusBadge.textContent = 'Private';
                statusBadge.style.backgroundColor = '#FF9800';
                statusBadge.style.color = 'white';
            }
        }
        updateStatusBadge(isPublic);
        statusDisplay.appendChild(statusBadge);

        const actions = document.createElement('div');
        actions.className = 'card-actions';
        actions.style.display = 'flex';
        actions.style.gap = '8px';
        actions.style.flexWrap = 'wrap';

        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy Link';
        copyButton.addEventListener('click', () => {
            copyToClipboard(fullFileUrl, shortId);
        });

        const openButton = document.createElement('button');
        openButton.textContent = 'Open in New Tab';
        openButton.addEventListener('click', () => {
            window.open(fullFileUrl, '_blank');
        });

        // Toggle public/private button
        const toggleButton = document.createElement('button');
        toggleButton.style.backgroundColor = isPublic ? '#4CAF50' : '#FF9800';
        toggleButton.style.color = 'white';
        toggleButton.textContent = isPublic ? '🔓 Make Private' : '🔒 Make Public';
        toggleButton.addEventListener('click', async () => {
            const shortId = fileUrl.split('/').pop().split('.')[0];
            try {
                const response = await fetch('/api/toggle-public', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        shortId: shortId,
                        sessionKey: currentSessionKey
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    const newIsPublic = result.isPublic;
                    
                    // Update button appearance
                    toggleButton.style.backgroundColor = newIsPublic ? '#4CAF50' : '#FF9800';
                    toggleButton.textContent = newIsPublic ? '🔓 Make Private' : '🔒 Make Public';
                    
                    // Update status badge
                    updateStatusBadge(newIsPublic);
                    
                    // Update localStorage
                    const history = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
                    const itemIndex = history.findIndex(item => item.fileUrl === fileUrl);
                    if (itemIndex !== -1) {
                        history[itemIndex].isPublic = newIsPublic;
                        localStorage.setItem('uploadHistory', JSON.stringify(history));
                    }
                    
                    // Show success message
                    console.log(result.message);
                } else {
                    const error = await response.json();
                    console.error('Failed to toggle public status:', error.error);
                    alert('Failed to toggle public status: ' + error.error);
                }
            } catch (error) {
                console.error('Error toggling public status:', error);
                alert('Error toggling public status. Please try again.');
            }
        });

        const removeButton = document.createElement('button');
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', async () => {
            const shortId = fileUrl.split('/').pop().split('.')[0];
            const response = await fetch(`/delete/${shortId}`, { method: 'DELETE' });
            if (response.ok) {
                card.remove();
                // Call removeFromHistory with the same URL format used when adding to history
                removeFromHistory(fileUrl);

                // Force refresh the history display to ensure UI is consistent
                historyCards.innerHTML = '';
                await loadHistory();
                
                // Trigger sync to notify other devices of the deletion
                try {
                    await syncSessionFiles();
                    console.log('Synced file deletion across devices');
                } catch (error) {
                    console.log('Failed to sync deletion:', error);
                }
            } else {
                console.error('Error deleting file');
            }
        });

        actions.appendChild(copyButton);
        actions.appendChild(openButton);
        actions.appendChild(toggleButton);
        actions.appendChild(removeButton);

        // Assemble the info container in correct order
        infoContainer.appendChild(link);
        if (fileInfo) {
            infoContainer.appendChild(fileInfoDisplay);
        }
        infoContainer.appendChild(linkDisplay);
        infoContainer.appendChild(statusDisplay);
        infoContainer.appendChild(actions);

        // Add preview left, info right
        if (previewContainer.childNodes.length > 0) {
            card.appendChild(previewContainer);
        }
        card.appendChild(infoContainer);

        return card;
    }
    function removeFromHistory(fileUrl) {
        const history = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
        // Use filter with full URL or partial URL to ensure proper removal
        const updatedHistory = history.filter(item => {
            // Compare either full URL or just the path
            return item.fileUrl !== fileUrl &&
                `${baseUrl}${item.fileUrl}` !== fileUrl;
        });
        localStorage.setItem('uploadHistory', JSON.stringify(updatedHistory));
        
        // Update session stats
        updateSessionDisplay();
    }

    loadHistory();

    // Theme selection
    themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        document.body.className = theme;
        localStorage.setItem('theme', theme);
    });

    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'catppuccin';
    themeSelect.value = savedTheme;
    document.body.className = savedTheme;

    // Load saved Exif stripping option
    const savedStripExif = localStorage.getItem('stripExif') === 'true';
    stripExifCheckbox.checked = savedStripExif;

    stripExifCheckbox.addEventListener('change', () => {
        localStorage.setItem('stripExif', stripExifCheckbox.checked);
    });

    // Initial fetch of disk space
    fetchDiskSpace();
});

function dataURLToBlob(dataURL) {
    const parts = dataURL.split(',');
    const byteString = atob(parts[1]);
    const mimeString = parts[0].split(':')[1].split(';')[0];

    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uintArray = new Uint8Array(arrayBuffer);

    for (let i = 0; i < byteString.length; i++) {
        uintArray[i] = byteString.charCodeAt(i);
    }

    return new Blob([arrayBuffer], { type: mimeString });
}

// Legal Modal Functionality
document.addEventListener('DOMContentLoaded', function() {
    const legalInfoBtn = document.getElementById('legal-info-btn');
    const legalModal = document.getElementById('legal-modal');
    const closeLegalModal = document.getElementById('close-legal-modal');
    const acceptLegalBtn = document.getElementById('accept-legal');

    // Open legal modal
    legalInfoBtn?.addEventListener('click', function() {
        legalModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    });

    // Close legal modal
    function closeLegalModalFunc() {
        legalModal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    }

    closeLegalModal?.addEventListener('click', closeLegalModalFunc);
    acceptLegalBtn?.addEventListener('click', closeLegalModalFunc);

    // Close modal when clicking outside
    legalModal?.addEventListener('click', function(e) {
        if (e.target === legalModal) {
            closeLegalModalFunc();
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !legalModal.classList.contains('hidden')) {
            closeLegalModalFunc();
        }
    });
});

// Notification System Functions
function initializeNotifications() {
    fetchNotification();
    setupNotificationDismiss();
    
    // Refresh notification every 30 seconds
    setInterval(fetchNotification, 30000);
}

async function fetchNotification() {
    try {
        const response = await fetch('/api/notification');
        if (response.ok) {
            const notification = await response.json();
            if (notification) {
                showNotification(notification.message, notification.type);
            } else {
                hideNotification();
            }
        }
    } catch (error) {
        console.error('Failed to fetch notification:', error);
    }
}

function showNotification(message, type = 'info') {
    const notificationBar = document.getElementById('notification-bar');
    const notificationMessage = document.getElementById('notification-message');
    
    if (notificationBar && notificationMessage) {
        notificationMessage.textContent = message;
        notificationBar.className = `notification-bar ${type}`;
        document.body.classList.add('notification-active');
    }
}

function hideNotification() {
    const notificationBar = document.getElementById('notification-bar');
    if (notificationBar) {
        notificationBar.classList.add('hidden');
        document.body.classList.remove('notification-active');
    }
}

function setupNotificationDismiss() {
    // Dismiss functionality removed - notifications are permanent until admin removes them
}

// Enhanced media handling and streaming optimizations
function isMediaFile(filename) {
    const mediaExtensions = [
        // Video formats
        '.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.flv',
        // Audio formats  
        '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma',
        // Image formats
        '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.tiff'
    ];
    
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return mediaExtensions.includes(ext);
}

function getFileIcon(filename) {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    
    // Video files
    if (['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v'].includes(ext)) {
        return '🎬';
    }
    // Audio files
    if (['.mp3', '.wav', '.flac', '.ogg', '.m4a'].includes(ext)) {
        return '🎵';
    }
    // Image files
    if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'].includes(ext)) {
        return '🖼️';
    }
    // Documents
    if (['.pdf', '.doc', '.docx', '.txt'].includes(ext)) {
        return '📄';
    }
    // Archives
    if (['.zip', '.rar', '.7z', '.tar'].includes(ext)) {
        return '📦';
    }
    
    return '📁'; // Default file icon
}

function createOptimizedMediaElement(url, filename, mimeType) {
    const container = document.createElement('div');
    container.className = 'media-preview';
    
    if (mimeType.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.preload = 'metadata'; // Only load metadata initially
        video.style.maxWidth = '100%';
        video.style.maxHeight = '400px';
        
        // Add error handling
        video.addEventListener('error', (e) => {
            console.log('Video loading error:', e);
            container.innerHTML = `<p>❌ Unable to preview video: ${filename}</p>`;
        });
        
        container.appendChild(video);
    } else if (mimeType.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.controls = true;
        audio.preload = 'metadata';
        audio.style.width = '100%';
        
        audio.addEventListener('error', (e) => {
            console.log('Audio loading error:', e);
            container.innerHTML = `<p>❌ Unable to preview audio: ${filename}</p>`;
        });
        
        container.appendChild(audio);
    } else if (mimeType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = filename;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '400px';
        img.style.objectFit = 'contain';
        img.loading = 'lazy'; // Lazy loading for images
        
        img.addEventListener('error', (e) => {
            console.log('Image loading error:', e);
            container.innerHTML = `<p>❌ Unable to preview image: ${filename}</p>`;
        });
        
        container.appendChild(img);
    } else {
        container.innerHTML = `<p>${getFileIcon(filename)} ${filename}</p>`;
    }
    
    return container;
}

// Enhanced file info fetching with caching
const fileInfoCache = new Map();

async function getFileInfo(shortId) {
    // Check cache first
    if (fileInfoCache.has(shortId)) {
        return fileInfoCache.get(shortId);
    }
    
    try {
        const response = await fetch(`/api/file/${shortId}/info`);
        if (response.ok) {
            const info = await response.json();
            // Cache the info for 5 minutes
            setTimeout(() => fileInfoCache.delete(shortId), 5 * 60 * 1000);
            fileInfoCache.set(shortId, info);
            return info;
        }
    } catch (error) {
        console.log('Error fetching file info:', error);
    }
    
    return null;
}

// Format file size for display
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Enhanced copy functionality with media info
async function copyToClipboard(text, shortId = null) {
    try {
        await navigator.clipboard.writeText(text);
        
        let message = 'Link copied to clipboard!';
        
        // Add file info if available
        if (shortId) {
            const fileInfo = await getFileInfo(shortId);
            if (fileInfo) {
                message += `\n${getFileIcon(fileInfo.originalName)} ${fileInfo.originalName} (${formatFileSize(fileInfo.size)})`;
                
                if (fileInfo.supportsRangeRequests) {
                    message += ' - Streaming enabled ⚡';
                }
            }
        }
        
        showNotification(message, 'success');
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            document.execCommand('copy');
            showNotification('Link copied to clipboard!', 'success');
        } catch (fallbackErr) {
            showNotification('Failed to copy link', 'error');
        }
        
        document.body.removeChild(textArea);
    }
}

// Session notification system
function showSessionNotification(message, type = 'info') {
    // Remove any existing notification
    const existing = document.querySelector('.session-notification');
    if (existing) {
        existing.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `session-notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}