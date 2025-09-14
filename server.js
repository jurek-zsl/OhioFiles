const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const fs = require('fs');  // Import fs for renaming files
const os = require('os'); // Required for disk space, though 'check-disk-space' is better for cross-platform
const checkDiskSpace = require('check-disk-space').default; // Import the library
const etag = require('etag');
const fresh = require('fresh');
const rangeParser = require('range-parser');
const compression = require('compression');


const port = process.env.PORT || 3001;
const app = express();

// Enable compression for all responses (except streaming files)
app.use(compression({
    filter: (req, res) => {
        // Don't compress responses if they are already compressed or are streaming
        if (res.getHeader('Content-Encoding')) {
            return false;
        }
        
        // Don't compress range requests (streaming)
        if (req.headers.range) {
            return false;
        }
        
        // Don't compress large media files
        const contentType = res.getHeader('Content-Type');
        if (contentType && (
            contentType.startsWith('video/') ||
            contentType.startsWith('audio/') ||
            contentType.startsWith('image/')
        )) {
            return false;
        }
        
        return compression.filter(req, res);
    },
    threshold: 1024 // Only compress responses larger than 1KB
}));

// parse JSON and urlencoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add global admin settings
let uploadSpeedLimit = 10;           // files per minute
let techPause = false;               // service availability
let maxFileSize = 100;               // MB
let publicUploadsAllowed = true;     // allow public uploads
let requireCaptcha = false;          // require captcha
let logUploads = true;               // log all uploads

// Serve admin frontend from the 'admin' subfolder with caching
app.use('/admin', express.static(path.join(__dirname, 'admin'), { 
    index: 'index.html',
    maxAge: '1h', // Cache admin files for 1 hour
    etag: true,
    lastModified: true
}));
app.get(['/admin','/admin/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// Connect to MongoDB with better error handling
mongoose.connect('mongodb://127.0.0.1/ohiofiles', { 
    useNewUrlParser: true, 
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000 // Timeout after 5s instead of 30s
}).catch(err => {
    console.warn('MongoDB connection failed:', err.message);
    console.warn('The server will run without database functionality');
});

// Update File model to track IP and size
const File = mongoose.model('File', {
    originalName: String,
    storedName: String,
    path: String,
    shortId: String,
    size: Number,
    ip: String,
    isPublic: { type: Boolean, default: false },
    uploadDate: { type: Date, default: Date.now },
    sessionKey: String
});

// Update Ban model to include reason and creation date
const BannedIP = mongoose.model('BannedIP', {
    ip: String,
    bannedUntil: Date,
    permanent: Boolean,
    reason: String,
    createdAt: { type: Date, default: Date.now }
});

// Notification model for admin notifications
const Notification = mongoose.model('Notification', {
    message: String,
    type: { type: String, enum: ['info', 'warning', 'error', 'success'], default: 'info' },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Ensure uploads directory is absolute and exists; adjust multer to use absolute dest; add reserved name check
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    console.log('Creating upload directory at', uploadDir);
    fs.mkdirSync(uploadDir);
}

// Set up multer for file uploads (absolute path)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const tempName = Date.now() + '-' + file.originalname;  // Temporary filename
        cb(null, tempName);
    }
});

// Reserved names
const RESERVED = ['admin'];

// Enhanced MIME type detection with streaming optimizations
function getOptimizedMimeType(filename) {
    const mimeType = mime.lookup(filename) || 'application/octet-stream';
    const ext = path.extname(filename).toLowerCase();
    
    // Override for better streaming support
    const streamingTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.m4v': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg'
    };
    
    return streamingTypes[ext] || mimeType;
}

// Utility function to determine if file should support range requests
function supportsRangeRequests(mimeType) {
    return mimeType.startsWith('video/') || 
           mimeType.startsWith('audio/') || 
           mimeType === 'application/pdf' ||
           mimeType.startsWith('image/');
}

// Handle both file uploads and form fields
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 * 1024 // 10GB max (will be checked in route logic)
    }
});

// Serve static files
// Public files API (move above static middleware)
app.get('/api/public-files', async (req, res) => {
    try {
        const files = await File.find({ isPublic: true }).sort({ uploadDate: -1 }).select('originalName storedName uploadDate');
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch public files' });
    }
});

// Serve static files with enhanced caching
app.use(express.static('public', {
    maxAge: '1d', // Cache static assets for 1 day
    etag: true,
    lastModified: true,
    setHeaders: (res, path, stat) => {
        // Set specific cache headers for different file types
        if (path.endsWith('.css') || path.endsWith('.js')) {
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day for CSS/JS
        } else if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.gif') || path.endsWith('.svg')) {
            res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week for images
        } else {
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour for other files
        }
    }
}));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route to get disk space - renamed to avoid potential conflicts with routing
app.get('/disk-space-api', async (req, res) => {
    try {
        // For Windows, use the drive where the project is located
        const diskPath = process.platform === 'win32' ? 'C:' : '/';

        const diskSpace = await checkDiskSpace(diskPath);
        res.json({
            total: diskSpace.size,
            free: diskSpace.free,
            diskPath: diskPath
        });
    } catch (error) {
        console.error('Error getting disk space:', error);
        res.status(500).json({ error: 'Could not retrieve disk space information' });
    }
});

// Rate limiting for file uploads: max 10 per minute, if >100 in 5 minutes block 24 hours
const rateLimits = new Map();  // key: IP, value: {timestamps: [Date], blockedUntil: Date}

function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    // Block if tech pause is active
    if (techPause) {
        return res.status(503).json({ error: 'Service temporarily paused by admin' });
    }
    let entry = rateLimits.get(ip) || { timestamps: [], blockedUntil: null };
    rateLimits.set(ip, entry);
    // Check 24h block
    if (entry.blockedUntil && now < entry.blockedUntil) {
        return res.status(429).json({ error: 'Too many uploads - try again later' });
    }
    // Clean old timestamps
    const window5 = now - 5 * 60 * 1000;
    entry.timestamps = entry.timestamps.filter(ts => ts > window5);
    // Check per-minute limit via dynamic setting
    const window1 = now - 60 * 1000;
    const count1 = entry.timestamps.filter(ts => ts > window1).length;
    if (count1 >= uploadSpeedLimit) {
        return res.status(429).json({ error: `Upload limit exceeded: ${uploadSpeedLimit} per minute` });
    }
    entry.timestamps.push(now);
    // Block for 24h if threshold exceeded
    if (entry.timestamps.length > 100) {
        entry.blockedUntil = now + 24 * 60 * 60 * 1000;
        return res.status(429).json({ error: 'Too many uploads - blocked for 24 hours' });
    }
    next();
}

// Update IP extraction logic
const getRealIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim(); // Get the first IP in the list
    }
    return req.ip || req.connection.remoteAddress;
};

// Middleware to check if an IP is banned
async function checkBanMiddleware(req, res, next) {
    try {
        const ip = getRealIp(req);
        const banned = await BannedIP.findOne({ ip });
        if (banned) {
            if (banned.permanent) {
                return res.status(403).json({ error: 'Your IP is permanently banned' });
            }
            if (banned.bannedUntil) {
                const now = new Date();
                if (now < banned.bannedUntil) {
                    const remainingTime = Math.ceil((banned.bannedUntil - now) / 1000); // Calculate remaining time in seconds
                    return res.status(403).json({ error: `Your IP is banned for ${remainingTime} seconds` });
                } else {
                    // Remove expired ban
                    await BannedIP.deleteOne({ ip });
                }
            }
        }
        next();
    } catch (err) {
        console.error('Error in checkBanMiddleware:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}

// File upload route with enhanced error handling
// Public files API
app.get('/api/public-files', async (req, res) => {
    try {
        const files = await File.find({ isPublic: true }).sort({ uploadDate: -1 }).select('originalName storedName uploadDate');
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch public files' });
    }
});

// Toggle file public/private status (public endpoint)
app.post('/api/toggle-public', async (req, res) => {
    try {
        const { shortId, sessionKey } = req.body;
        
        // Find the file and verify it belongs to the session
        const file = await File.findOne({ shortId });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Check if the file belongs to the provided session
        if (file.sessionKey !== sessionKey) {
            return res.status(403).json({ error: 'Unauthorized: File does not belong to this session' });
        }
        
        // Toggle the public status
        file.isPublic = !file.isPublic;
        await file.save();
        
        res.json({ 
            success: true, 
            isPublic: file.isPublic,
            message: `File is now ${file.isPublic ? 'public' : 'private'}`
        });
    } catch (error) {
        console.error('Error toggling file status:', error);
        res.status(500).json({ error: 'Failed to update file status' });
    }
});

app.post('/upload', rateLimitMiddleware, checkBanMiddleware, upload.single('file'), async (req, res) => {
    console.log('Upload API called. Body:', req.body, 'File:', req.file);
    console.log('Headers:', req.headers['x-admin-pin'] ? 'Admin PIN provided' : 'No admin PIN');
    try {
        // Check if public uploads are allowed
        const isPublic = req.body.isPublic === 'true';
        if (isPublic && !publicUploadsAllowed) {
            return res.status(403).json({ error: 'Public uploads are currently disabled' });
        }

        // Check for admin bypass
        const bypassSizeLimit = req.body.bypassSizeLimit === 'true';
        const adminPin = req.headers['x-admin-pin'];
        const isAdminRequest = adminPin && adminPin === ADMIN_PIN;
        
        console.log('Bypass requested:', bypassSizeLimit, 'Admin request:', isAdminRequest, 'File size:', req.file ? Math.round(req.file.size / 1024 / 1024) + 'MB' : 'No file');

        // Check file size limit (bypass if admin)
        if (req.file && req.file.size > maxFileSize * 1024 * 1024) {
            if (!bypassSizeLimit || !isAdminRequest) {
                fs.unlinkSync(req.file.path); // Clean up uploaded file
                return res.status(400).json({ error: `File size exceeds ${maxFileSize}MB limit` });
            }
            // Admin bypassing size limit
            console.log(`Admin bypassing size limit for file: ${req.file.originalname} (${Math.round(req.file.size / 1024 / 1024)}MB)`);
        }

        // guard reserved custom names
        if (req.body.customFilename) {
            const sanitized = req.body.customFilename
                .toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
            if (RESERVED.includes(sanitized)) {
                return res.status(400).json({ error: 'That filename is reserved' });
            }
        }
        if (!req.file) {
            console.error('No file in request');
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const ip = getRealIp(req); // Extract real IP
        const size = req.file.size;
        console.log('Processing upload for:', req.file.originalname, 'from IP:', ip);

        // Generate a unique shortId (or use custom name if provided)
        let shortId;
        let fileExists;

        if (req.body.customFilename && req.body.customFilename.length > 0) {
            const customFilename = req.body.customFilename.trim();
            console.log('Using custom filename:', customFilename);

            // Use custom filename but ensure it's URL-safe
            shortId = customFilename
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '-') // Replace non-alphanumeric chars with hyphens
                .replace(/-+/g, '-')        // Replace multiple hyphens with single hyphen
                .replace(/^-|-$/g, '');     // Remove leading/trailing hyphens

            // Ensure the custom name is not empty after sanitization
            if (!shortId) {
                shortId = crypto.randomBytes(3).toString('hex');
            } else {
                // Check if custom name already exists
                fileExists = await File.findOne({ shortId });
                if (fileExists) {
                    // Append random string to make it unique
                    shortId = shortId + '-' + crypto.randomBytes(2).toString('hex');
                }
            }
        } else {
            // Generate random name if no custom name provided
            do {
                shortId = crypto.randomBytes(3).toString('hex');
                fileExists = await File.findOne({ shortId });
            } while (fileExists);
        }

        const originalName = req.file.originalname;  // Original file name (with extension)
        const extension = path.extname(originalName); // Get the file extension
        const storedName = shortId + extension;      // New file name with extension
        const oldPath = req.file.path;
        // build absolute path for storage
        const newPath = path.join(uploadDir, storedName);
        console.log(`Renaming from ${req.file.path} to ${newPath}`);
        await fs.promises.rename(req.file.path, newPath);
        console.log('Rename successful');
        // Save metadata
        const fileIsPublic = req.body.isPublic === 'true';
        const sessionKey = req.body.sessionKey;
        console.log('Saving file with session key:', sessionKey);
        
        await new File({ 
            originalName, 
            storedName, 
            path: newPath, 
            shortId, 
            size, 
            ip, 
            isPublic: fileIsPublic,
            sessionKey 
        }).save();
        console.log('Metadata saved successfully');
        return res.json({ fileUrl: `/${storedName}`, originalName });
    } catch (err) {
        console.error('Upload handler error:', err.stack || err);
        return res.status(500).json({ error: 'Internal server error: ' + err.message });
    }
});

// File deletion route
app.delete('/delete/:shortId', async (req, res) => {
    const shortId = req.params.shortId;
    const file = await File.findOne({ shortId });

    if (!file) {
        return res.status(404).json({ error: 'File not found' });
    }

    await File.deleteOne({ shortId });
    fs.unlink(file.path, (err) => {
        if (err) {
            console.error('Error deleting file:', err);
            return res.status(500).json({ error: 'Error deleting file' });
        }
        res.json({ message: 'File deleted successfully' });
    });
});

// File preview route - Enhanced with caching and streaming support
app.get('/:storedName', async (req, res, next) => {
  // skip admin base path
  if (req.params.storedName.toLowerCase() === 'admin') return next();
   
   try {
       const storedName = req.params.storedName;
       const shortId = path.basename(storedName, path.extname(storedName));
       const file = await File.findOne({ shortId });

       if (!file) {
           return res.status(404).send('File not found');
       }

       const filePath = path.resolve(file.path);
       
       // Check if file exists on disk
       if (!fs.existsSync(filePath)) {
           return res.status(404).send('File not found on disk');
       }

       const stats = fs.statSync(filePath);
       const mimeType = getOptimizedMimeType(file.originalName);
       const supportsRanges = supportsRangeRequests(mimeType);
       
       // Generate ETag based on file stats
       const fileETag = etag(stats);
       
       // Set caching headers
       res.setHeader('ETag', fileETag);
       res.setHeader('Content-Type', mimeType);
       res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
       
       // Set cache headers based on file type
       if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
           res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days for media
       } else if (mimeType.startsWith('image/')) {
           res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 days for images
       } else {
           res.setHeader('Cache-Control', 'public, max-age=86400, immutable'); // 1 day for other files
       }
       
       // Only set Accept-Ranges for files that support it
       if (supportsRanges) {
           res.setHeader('Accept-Ranges', 'bytes');
       }
       
       // Check if client has cached version (304 Not Modified)
       if (fresh(req.headers, { etag: fileETag })) {
           return res.status(304).end();
       }

       // Handle Range requests for streaming (videos, large files)
       const range = req.headers.range;
       
       if (range && supportsRanges) {
           // Parse range header
           const ranges = rangeParser(stats.size, range, { combine: true });
           
           if (ranges === -1) {
               // Invalid range
               res.setHeader('Content-Range', `bytes */${stats.size}`);
               return res.status(416).send('Range Not Satisfiable');
           }
           
           if (ranges === -2) {
               // Malformed range - serve full file
               res.setHeader('Content-Length', stats.size);
               return fs.createReadStream(filePath).pipe(res);
           }
           
           // Valid range request
           const { start, end } = ranges[0];
           const chunkSize = (end - start) + 1;
           
           res.status(206); // Partial Content
           res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
           res.setHeader('Content-Length', chunkSize);
           
           // Create read stream for the requested range
           const stream = fs.createReadStream(filePath, { start, end });
           stream.pipe(res);
           
           stream.on('error', (err) => {
               console.error('Stream error:', err);
               if (!res.headersSent) {
                   res.status(500).send('Error streaming file');
               }
           });
           
       } else {
           // No range request - serve full file
           res.setHeader('Content-Length', stats.size);
           
           const stream = fs.createReadStream(filePath);
           stream.pipe(res);
           
           stream.on('error', (err) => {
               console.error('Stream error:', err);
               if (!res.headersSent) {
                   res.status(500).send('Error serving file');
               }
           });
       }
       
   } catch (error) {
       console.error('File serving error:', error);
       res.status(500).send('Internal server error');
   }
});

// Admin authentication
const ADMIN_PIN = '150515';
function adminAuth(req, res, next) {
    // Accept pin in header for API requests
    const pin = req.headers['x-admin-pin'] || req.body.pin;
    if (pin !== ADMIN_PIN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
// Protect all admin API routes
app.use('/api/admin', adminAuth);

// Admin API routes
// List files
app.get('/api/admin/files', async (req, res) => {
    const files = await File.find().sort({ uploadDate: -1 });
    res.json(files);
});
// Rename file
app.post('/api/admin/rename', async (req, res) => {
    const { shortId, newName } = req.body;
    const file = await File.findOne({ shortId });
    if (!file) return res.status(404).json({ error: 'File not found' });
    const ext = path.extname(file.storedName);
    const newStored = newName + ext;
    const newPath = path.join('uploads', newStored);
    fs.renameSync(file.path, newPath);
    file.storedName = newStored;
    file.path = newPath;
    await file.save();
    res.json({ success: true });
});
// Delete file
app.delete('/api/admin/files/:shortId', async (req, res) => {
    const { shortId } = req.params;
    const file = await File.findOne({ shortId }); if (!file) return res.status(404).json({ error: 'File not found' });
    await File.deleteOne({ shortId });
    fs.unlinkSync(file.path);
    res.json({ success: true });
});
// List users (distinct IPs)
app.get('/api/admin/users', async (req, res) => {
    const ips = await File.distinct('ip');
    res.json(ips);
});
// Get activity
app.get('/api/admin/activity', async (req, res) => {
    const recent = await File.find().sort({ uploadDate: -1 }).limit(50);
    res.json(recent);
});
// Get settings and status
app.get('/api/admin/status', async (req, res) => {
    try {
        const diskPath = process.platform === 'win32' ? 'C:' : '/';
        const disk = await checkDiskSpace(diskPath);
        const uptime = process.uptime();
        res.json({ 
            uploadSpeedLimit, 
            techPause, 
            maxFileSize,
            publicUploads: publicUploadsAllowed,
            requireCaptcha,
            logUploads,
            disk,
            uptime: Math.floor(uptime),
            uptimeFormatted: formatUptime(uptime)
        });
    } catch (error) {
        console.error('Error getting status:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});
// Update settings
app.post('/api/admin/settings', (req, res) => {
    const { newLimit, pause, maxFileSize: newMaxSize, publicUploads, requireCaptcha: newCaptcha, logUploads: newLogging } = req.body;
    if (typeof newLimit === 'number') uploadSpeedLimit = newLimit;
    if (typeof pause === 'boolean') techPause = pause;
    if (typeof newMaxSize === 'number') maxFileSize = newMaxSize;
    if (typeof publicUploads === 'boolean') publicUploadsAllowed = publicUploads;
    if (typeof newCaptcha === 'boolean') requireCaptcha = newCaptcha;
    if (typeof newLogging === 'boolean') logUploads = newLogging;
    res.json({ success: true });
});
// Ban IP
app.post('/api/admin/ban', async (req, res) => {
    const { ip, duration, permanent, reason } = req.body;
    const bannedUntil = duration ? new Date(Date.now() + duration * 1000) : null;
    await BannedIP.updateOne(
        { ip },
        { ip, bannedUntil, permanent: !!permanent, reason: reason || 'No reason provided', createdAt: new Date() },
        { upsert: true }
    );
    res.json({ success: true });
});
// Unban IP
app.post('/api/admin/unban', async (req, res) => {
    const { ip } = req.body;
    await BannedIP.deleteOne({ ip });
    res.json({ success: true });
});
// List banned IPs
app.get('/api/admin/banned-ips', async (req, res) => {
    const bannedIps = await BannedIP.find();
    res.json(bannedIps);
});

// Toggle file public/private status
app.post('/api/admin/toggle-public', async (req, res) => {
    try {
        const { shortId, isPublic } = req.body;
        const file = await File.findOne({ shortId });
        if (!file) return res.status(404).json({ error: 'File not found' });
        
        file.isPublic = isPublic;
        await file.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update file status' });
    }
});

// Bulk delete files
app.post('/api/admin/bulk-delete', async (req, res) => {
    try {
        const { fileIds } = req.body;
        const files = await File.find({ shortId: { $in: fileIds } });
        
        for (const file of files) {
            try {
                fs.unlinkSync(file.path);
            } catch (err) {
                console.error('Error deleting file:', err);
            }
        }
        
        await File.deleteMany({ shortId: { $in: fileIds } });
        res.json({ success: true, deletedCount: files.length });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete files' });
    }
});

// Clear all files
app.post('/api/admin/clear-all', async (req, res) => {
    try {
        const files = await File.find();
        
        for (const file of files) {
            try {
                fs.unlinkSync(file.path);
            } catch (err) {
                console.error('Error deleting file:', err);
            }
        }
        
        await File.deleteMany({});
        res.json({ success: true, deletedCount: files.length });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear all files' });
    }
});

// Export data
app.get('/api/admin/export', async (req, res) => {
    try {
        const files = await File.find().sort({ uploadDate: -1 });
        const bannedIps = await BannedIP.find();
        
        const exportData = {
            exportDate: new Date().toISOString(),
            totalFiles: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            files: files.map(f => ({
                originalName: f.originalName,
                storedName: f.storedName,
                size: f.size,
                ip: f.ip,
                isPublic: f.isPublic,
                uploadDate: f.uploadDate,
                shortId: f.shortId
            })),
            bannedIps: bannedIps.map(b => ({
                ip: b.ip,
                bannedUntil: b.bannedUntil,
                permanent: b.permanent
            })),
            settings: {
                uploadSpeedLimit,
                techPause
            }
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="ohiofiles-export-${new Date().toISOString().split('T')[0]}.json"`);
        res.json(exportData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// System info
app.get('/api/admin/system-info', async (req, res) => {
    try {
        const diskPath = process.platform === 'win32' ? 'C:' : '/';
        const disk = await checkDiskSpace(diskPath);
        const totalFiles = await File.countDocuments();
        const totalBanned = await BannedIP.countDocuments();
        const uptime = process.uptime();
        
        const systemInfo = {
            uptime: Math.floor(uptime),
            uptimeFormatted: formatUptime(uptime),
            diskSpace: {
                total: disk.size,
                free: disk.free,
                used: disk.size - disk.free,
                freePercent: ((disk.free / disk.size) * 100).toFixed(2)
            },
            fileStats: {
                totalFiles,
                totalBanned,
                uploadSpeedLimit,
                techPause
            },
            nodeVersion: process.version,
            platform: process.platform,
            memoryUsage: process.memoryUsage()
        };
        
        res.json(systemInfo);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get system info' });
    }
});

// Backup data
app.get('/api/admin/backup', async (req, res) => {
    try {
        const files = await File.find();
        const bannedIps = await BannedIP.find();
        
        const backup = {
            backupDate: new Date().toISOString(),
            version: '1.0',
            files,
            bannedIps,
            settings: {
                uploadSpeedLimit,
                techPause
            }
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="ohiofiles-backup-${new Date().toISOString().split('T')[0]}.json"`);
        res.json(backup);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create backup' });
    }
});

// Analytics data
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const { period = 'all' } = req.query;
        let dateFilter = {};
        
        const now = new Date();
        if (period === 'today') {
            dateFilter.uploadDate = { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
        } else if (period === 'week') {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            dateFilter.uploadDate = { $gte: weekAgo };
        } else if (period === 'month') {
            const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
            dateFilter.uploadDate = { $gte: monthAgo };
        }
        
        const files = await File.find(dateFilter);
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        const uniqueIps = new Set(files.map(f => f.ip)).size;
        
        // File type distribution
        const fileTypes = {};
        files.forEach(f => {
            const ext = f.storedName.split('.').pop().toLowerCase();
            const type = getFileType(ext);
            fileTypes[type] = (fileTypes[type] || 0) + 1;
        });
        
        // Upload trends (by day)
        const uploadTrends = {};
        files.forEach(f => {
            const date = f.uploadDate.toISOString().split('T')[0];
            uploadTrends[date] = (uploadTrends[date] || 0) + 1;
        });
        
        res.json({
            period,
            totalFiles: files.length,
            totalSize,
            uniqueIps,
            fileTypes,
            uploadTrends,
            averageFileSize: files.length > 0 ? totalSize / files.length : 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get analytics data' });
    }
});

// Helper function to format uptime
function formatUptime(uptimeSeconds) {
    const days = Math.floor(uptimeSeconds / (24 * 60 * 60));
    const hours = Math.floor((uptimeSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((uptimeSeconds % (60 * 60)) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Helper function to get file type category
function getFileType(ext) {
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv'];
    const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf'];
    
    if (imageExts.includes(ext)) return 'Images';
    if (videoExts.includes(ext)) return 'Videos';
    if (docExts.includes(ext)) return 'Documents';
    return 'Other';
}

// Session Management API endpoints
// Get session files
app.get('/api/session/:sessionKey/files', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        console.log('Fetching files for session key:', sessionKey);
        
        if (!sessionKey || sessionKey.length < 5 || sessionKey.length > 50 || !/^[a-zA-Z0-9]+$/.test(sessionKey)) {
            console.log('Invalid session key format:', sessionKey);
            return res.status(400).json({ error: 'Invalid session key' });
        }
        
        const files = await File.find({ sessionKey }).sort({ uploadDate: -1 });
        console.log(`Found ${files.length} files for session ${sessionKey}`);
        console.log('Files:', files.map(f => ({ name: f.originalName, sessionKey: f.sessionKey })));
        
        res.json(files.map(f => ({
            originalName: f.originalName,
            storedName: f.storedName,
            uploadDate: f.uploadDate,
            size: f.size,
            isPublic: f.isPublic,
            sessionKey: f.sessionKey
        })));
    } catch (error) {
        console.error('Error fetching session files:', error);
        res.status(500).json({ error: 'Failed to fetch session files' });
    }
});

// Store session file
app.post('/api/session/store', async (req, res) => {
    try {
        const { sessionKey, fileUrl, fileName, uploadDate } = req.body;
        
        if (!sessionKey || sessionKey.length !== 32) {
            return res.status(400).json({ error: 'Invalid session key' });
        }
        
        // Find the file and update it with session key
        const storedName = fileUrl.replace('/', '');
        const file = await File.findOne({ storedName });
        
        if (file) {
            file.sessionKey = sessionKey;
            if (uploadDate) file.uploadDate = new Date(uploadDate);
            await file.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to store session data' });
    }
});

// Sync session
app.post('/api/session/sync', async (req, res) => {
    try {
        const { sessionKey, files } = req.body;
        
        if (!sessionKey || sessionKey.length !== 32) {
            return res.status(400).json({ error: 'Invalid session key' });
        }
        
        // Update files with session key
        for (const fileData of files) {
            const storedName = fileData.fileUrl.replace('/', '');
            await File.updateOne(
                { storedName },
                { 
                    sessionKey,
                    uploadDate: new Date(fileData.uploadDate || Date.now())
                }
            );
        }
        
        res.json({ success: true, synced: files.length });
    } catch (error) {
        res.status(500).json({ error: 'Failed to sync session' });
    }
});

// Export session data
app.get('/api/session/:sessionKey/export', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        const files = await File.find({ sessionKey }).sort({ uploadDate: -1 });
        
        const sessionData = {
            sessionKey,
            exportDate: new Date().toISOString(),
            fileCount: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            files: files.map(f => ({
                fileUrl: `/${f.storedName}`,
                fileName: f.originalName,
                uploadDate: f.uploadDate,
                size: f.size,
                isPublic: f.isPublic
            }))
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="session-${sessionKey.substring(0, 8)}-export.json"`);
        res.json(sessionData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export session' });
    }
});

// Notification API endpoints
// Get active notification for public display
app.get('/api/notification', async (req, res) => {
    try {
        const notification = await Notification.findOne({ active: true }).sort({ updatedAt: -1 });
        if (notification) {
            res.json({
                message: notification.message,
                type: notification.type,
                id: notification._id
            });
        } else {
            res.json(null);
        }
    } catch (error) {
        console.error('Error fetching notification:', error);
        res.status(500).json({ error: 'Failed to fetch notification' });
    }
});

// Admin notification endpoints
app.get('/api/admin/notifications', async (req, res) => {
    try {
        const notifications = await Notification.find().sort({ updatedAt: -1 });
        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

app.post('/api/admin/notification', async (req, res) => {
    try {
        const { message, type, active } = req.body;
        
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Deactivate all existing notifications if this one should be active
        if (active) {
            await Notification.updateMany({}, { active: false });
        }
        
        // Create new notification
        const notification = new Notification({
            message: message.trim(),
            type: type || 'info',
            active: active || false,
            updatedAt: new Date()
        });
        
        await notification.save();
        res.json({ success: true, notification });
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ error: 'Failed to create notification' });
    }
});

app.delete('/api/admin/notification/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

app.post('/api/admin/notification/clear', async (req, res) => {
    try {
        // Deactivate all notifications
        await Notification.updateMany({}, { active: false });
        res.json({ success: true });
    } catch (error) {
        console.error('Error clearing notifications:', error);
        res.status(500).json({ error: 'Failed to clear notifications' });
    }
});

app.post('/api/admin/notification/:id/restore', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Deactivate all other notifications
        await Notification.updateMany({}, { active: false });
        
        // Activate the specified notification
        const notification = await Notification.findByIdAndUpdate(
            id, 
            { active: true, updatedAt: new Date() }, 
            { new: true }
        );
        
        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        
        res.json({ success: true, notification });
    } catch (error) {
        console.error('Error restoring notification:', error);
        res.status(500).json({ error: 'Failed to restore notification' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack || err);
    res.status(500).json({ error: 'Server error' });
});

// Admin Session Management API endpoints
// Get all sessions with stats
app.get('/api/admin/sessions', async (req, res) => {
    try {
        const sessions = await File.aggregate([
            { $match: { sessionKey: { $exists: true, $ne: null } } },
            { 
                $group: {
                    _id: '$sessionKey',
                    fileCount: { $sum: 1 },
                    totalSize: { $sum: '$size' },
                    ips: { $addToSet: '$ip' },
                    firstUpload: { $min: '$uploadDate' },
                    lastActivity: { $max: '$uploadDate' },
                    files: { $push: { originalName: '$originalName', storedName: '$storedName', size: '$size', uploadDate: '$uploadDate' } }
                }
            },
            { $sort: { lastActivity: -1 } }
        ]);

        const sessionsWithStats = sessions.map(session => ({
            sessionKey: session._id,
            fileCount: session.fileCount,
            totalSize: session.totalSize,
            ipCount: session.ips.length,
            ips: session.ips,
            firstUpload: session.firstUpload,
            lastActivity: session.lastActivity,
            files: session.files,
            status: (Date.now() - new Date(session.lastActivity).getTime()) < 7 * 24 * 60 * 60 * 1000 ? 'active' : 'inactive'
        }));

        res.json(sessionsWithStats);
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

// Get session statistics
app.get('/api/admin/sessions/stats', async (req, res) => {
    try {
        const totalSessions = await File.distinct('sessionKey', { sessionKey: { $exists: true, $ne: null } });
        const totalFiles = await File.countDocuments();
        const filesWithSessions = await File.countDocuments({ sessionKey: { $exists: true, $ne: null } });
        const orphanedFiles = totalFiles - filesWithSessions;
        
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const activeSessions = await File.distinct('sessionKey', { 
            sessionKey: { $exists: true, $ne: null },
            uploadDate: { $gte: weekAgo }
        });

        const avgFilesPerSession = totalSessions.length > 0 ? Math.round(filesWithSessions / totalSessions.length) : 0;

        res.json({
            totalSessions: totalSessions.length,
            activeSessions: activeSessions.length,
            orphanedFiles,
            avgFilesPerSession
        });
    } catch (error) {
        console.error('Error fetching session stats:', error);
        res.status(500).json({ error: 'Failed to fetch session stats' });
    }
});

// Get specific session details
app.get('/api/admin/sessions/:sessionKey', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        const files = await File.find({ sessionKey }).sort({ uploadDate: -1 });
        
        if (files.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        const uniqueIps = [...new Set(files.map(file => file.ip))];
        
        res.json({
            sessionKey,
            fileCount: files.length,
            totalSize,
            ips: uniqueIps,
            firstUpload: files[files.length - 1].uploadDate,
            lastActivity: files[0].uploadDate,
            files: files.map(f => ({
                originalName: f.originalName,
                storedName: f.storedName,
                size: f.size,
                uploadDate: f.uploadDate,
                isPublic: f.isPublic,
                ip: f.ip
            }))
        });
    } catch (error) {
        console.error('Error fetching session details:', error);
        res.status(500).json({ error: 'Failed to fetch session details' });
    }
});

// Delete session and all its files
app.delete('/api/admin/sessions/:sessionKey', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        const files = await File.find({ sessionKey });
        
        // Delete physical files
        const fs = require('fs');
        for (const file of files) {
            try {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (err) {
                console.log('Error deleting file:', file.path, err);
            }
        }
        
        // Delete from database
        const result = await File.deleteMany({ sessionKey });
        
        res.json({ 
            message: 'Session deleted successfully',
            deletedFiles: result.deletedCount
        });
    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

// Clean orphaned files (files without session keys)
app.post('/api/admin/sessions/cleanup-orphaned', async (req, res) => {
    try {
        const orphanedFiles = await File.find({ 
            $or: [
                { sessionKey: { $exists: false } },
                { sessionKey: null },
                { sessionKey: '' }
            ]
        });
        
        // Delete physical files
        const fs = require('fs');
        for (const file of orphanedFiles) {
            try {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (err) {
                console.log('Error deleting orphaned file:', file.path, err);
            }
        }
        
        // Delete from database
        const result = await File.deleteMany({
            $or: [
                { sessionKey: { $exists: false } },
                { sessionKey: null },
                { sessionKey: '' }
            ]
        });
        
        res.json({
            message: 'Orphaned files cleaned up successfully',
            deletedFiles: result.deletedCount
        });
    } catch (error) {
        console.error('Error cleaning up orphaned files:', error);
        res.status(500).json({ error: 'Failed to clean up orphaned files' });
    }
});

// API endpoint to get file metadata for streaming optimization
app.get('/api/file/:shortId/info', async (req, res) => {
    try {
        const { shortId } = req.params;
        const file = await File.findOne({ shortId });
        
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const filePath = path.resolve(file.path);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }
        
        const stats = fs.statSync(filePath);
        const mimeType = getOptimizedMimeType(file.originalName);
        
        res.json({
            shortId: file.shortId,
            originalName: file.originalName,
            size: stats.size,
            mimeType: mimeType,
            supportsRangeRequests: supportsRangeRequests(mimeType),
            uploadDate: file.uploadDate,
            isPublic: file.isPublic,
            lastModified: stats.mtime
        });
    } catch (error) {
        console.error('File info error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API endpoint to get streaming statistics
app.get('/api/admin/streaming-stats', adminAuth, async (req, res) => {
    try {
        const totalFiles = await File.countDocuments();
        const videoFiles = await File.countDocuments({
            originalName: { $regex: /\.(mp4|webm|mkv|avi|mov|m4v)$/i }
        });
        const audioFiles = await File.countDocuments({
            originalName: { $regex: /\.(mp3|wav|flac|ogg|m4a)$/i }
        });
        const imageFiles = await File.countDocuments({
            originalName: { $regex: /\.(jpg|jpeg|png|gif|svg|webp)$/i }
        });
        
        // Calculate total size of media files
        const mediaFiles = await File.find({
            originalName: { $regex: /\.(mp4|webm|mkv|avi|mov|m4v|mp3|wav|flac|ogg|m4a|jpg|jpeg|png|gif|svg|webp)$/i }
        }).select('size');
        
        const totalMediaSize = mediaFiles.reduce((acc, file) => acc + (file.size || 0), 0);
        
        res.json({
            totalFiles,
            videoFiles,
            audioFiles,
            imageFiles,
            otherFiles: totalFiles - videoFiles - audioFiles - imageFiles,
            totalMediaSize,
            streamingEnabled: true
        });
    } catch (error) {
        console.error('Streaming stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API endpoint to get file metadata for streaming optimization
app.get('/api/file/:shortId/info', async (req, res) => {
    try {
        const { shortId } = req.params;
        const file = await File.findOne({ shortId });
        
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const filePath = path.resolve(file.path);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }
        
        const stats = fs.statSync(filePath);
        const mimeType = getOptimizedMimeType(file.originalName);
        
        res.json({
            shortId: file.shortId,
            originalName: file.originalName,
            size: stats.size,
            mimeType: mimeType,
            supportsRangeRequests: supportsRangeRequests(mimeType),
            uploadDate: file.uploadDate,
            isPublic: file.isPublic,
            lastModified: stats.mtime
        });
    } catch (error) {
        console.error('File info error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Enhanced caching and streaming support enabled`);
});
