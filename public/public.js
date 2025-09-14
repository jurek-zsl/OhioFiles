document.addEventListener('DOMContentLoaded', async () => {
    // Initialize notification system
    initializeNotifications();
    
    const publicFilesList = document.getElementById('public-files-list');

    async function fetchPublicFiles() {
        try {
            const response = await fetch('/api/public-files');
            if (!response.ok) throw new Error('Failed to fetch public files');
            const files = await response.json();
            publicFilesList.innerHTML = '';
            if (files.length === 0) {
                publicFilesList.innerHTML = '<div class="empty-message">No public files available.</div>';
                return;
            }
            files.forEach(file => {
                publicFilesList.appendChild(createPublicCard(file));
            });
        } catch (err) {
            publicFilesList.innerHTML = '<div class="error-message">Error loading public files.</div>';
        }
    }

    function createPublicCard(file) {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.padding = '16px';
        card.style.marginBottom = '16px';
        card.style.background = 'var(--bg-secondary, #222)';
        card.style.borderRadius = '10px';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)';

        // Preview
        const fileExt = file.originalName.split('.').pop().toLowerCase();
        const previewContainer = document.createElement('div');
        previewContainer.className = 'file-preview';
        previewContainer.style.display = 'flex';
        previewContainer.style.alignItems = 'center';
        previewContainer.style.justifyContent = 'center';
        previewContainer.style.marginRight = '20px';
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];
        const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv'];
        const fullFileUrl = `/${file.storedName}`;
        if (imageExts.includes(fileExt)) {
            const img = document.createElement('img');
            img.src = fullFileUrl;
            img.alt = file.originalName;
            img.style.maxWidth = '220px';
            img.style.maxHeight = '220px';
            img.style.borderRadius = '8px';
            img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            previewContainer.appendChild(img);
        } else if (videoExts.includes(fileExt)) {
            const video = document.createElement('video');
            video.src = fullFileUrl;
            video.controls = true;
            video.style.maxWidth = '220px';
            video.style.maxHeight = '220px';
            video.style.borderRadius = '8px';
            video.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            previewContainer.appendChild(video);
        }

        // Info
        const infoContainer = document.createElement('div');
        infoContainer.style.flex = '1';
        infoContainer.style.display = 'flex';
        infoContainer.style.flexDirection = 'column';
        infoContainer.style.justifyContent = 'center';
        infoContainer.style.gap = '8px';

        const link = document.createElement('a');
        link.href = fullFileUrl;
        link.textContent = file.originalName;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.fontSize = '1.1em';
        link.style.fontWeight = 'bold';
        link.style.wordBreak = 'break-all';

        const linkDisplay = document.createElement('div');
        linkDisplay.style.fontSize = '0.95em';
        linkDisplay.style.wordBreak = 'break-all';
        const linkAnchor = document.createElement('a');
        linkAnchor.href = fullFileUrl;
        linkAnchor.textContent = window.location.origin + fullFileUrl;
        linkAnchor.target = '_blank';
        linkAnchor.rel = 'noopener noreferrer';
        linkAnchor.style.wordBreak = 'break-all';
        linkDisplay.textContent = 'Link: ';
        linkDisplay.appendChild(linkAnchor);

        const actions = document.createElement('div');
        actions.className = 'card-actions';
        actions.style.display = 'flex';
        actions.style.gap = '8px';

        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy Link';
        copyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.origin + fullFileUrl);
        });

        const openButton = document.createElement('button');
        openButton.textContent = 'Open in New Tab';
        openButton.addEventListener('click', () => {
            window.open(fullFileUrl, '_blank');
        });

        actions.appendChild(copyButton);
        actions.appendChild(openButton);

        infoContainer.appendChild(link);
        infoContainer.appendChild(linkDisplay);
        infoContainer.appendChild(actions);

        if (previewContainer.childNodes.length > 0) {
            card.appendChild(previewContainer);
        }
        card.appendChild(infoContainer);

        // Date
        const date = document.createElement('div');
        date.className = 'file-date';
        date.textContent = `Uploaded: ${new Date(file.uploadDate).toLocaleString()}`;
        date.style.fontSize = '0.9em';
        date.style.color = 'var(--color-secondary, #aaa)';
        infoContainer.appendChild(date);

        return card;
    }

    fetchPublicFiles();
});

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
