const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const Database = require('better-sqlite3');
const net = require('net');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Basic Auth middleware for admin panel
const adminAuth = basicAuth({
    users: { 'admin': 'admin123' },
    challenge: true,
    realm: 'Admin Panel'
});

// Database setup
const db = new Database('proxies.db');

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT,
        password TEXT,
        is_used BOOLEAN DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        email TEXT,
        is_online BOOLEAN DEFAULT 0,
        last_checked_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS proxy_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        proxy_id INTEGER NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (proxy_id) REFERENCES proxies(id)
    );
`);

// Proxy status checker
async function checkProxyStatus(proxyIds = null) {
    console.log(`Starting proxy status check for ${proxyIds ? 'specific' : 'all'} proxies...`);
    let proxies;
    if (proxyIds && proxyIds.length > 0) {
        const placeholders = proxyIds.map(() => '?').join(',');
        proxies = db.prepare(`SELECT id, host, port FROM proxies WHERE id IN (${placeholders})`).all(...proxyIds);
    } else {
        proxies = db.prepare('SELECT id, host, port FROM proxies').all();
    }
    
    for (const proxy of proxies) {
        const { id, host, port } = proxy;
        let isOnline = false;

        try {
            await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(5000); // 5 seconds timeout
                
                socket.once('connect', () => {
                    isOnline = true;
                    socket.destroy();
                    resolve();
                });

                socket.once('timeout', () => {
                    socket.destroy();
                    reject(new Error('Timeout'));
                });

                socket.once('error', (err) => {
                    socket.destroy();
                    reject(err);
                });

                socket.connect(port, host);
            });
        } catch (error) {
            console.log(`Proxy ${host}:${port} is offline: ${error.message}`);
            isOnline = false;
        }

        db.prepare('UPDATE proxies SET is_online = ?, last_checked_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(isOnline ? 1 : 0, id);
    }
    console.log('Proxy status check completed.');
}

// Run check every 10 minutes
setInterval(() => checkProxyStatus(), 10 * 60 * 1000); // 10 minutes

// Run once on startup
checkProxyStatus();

// API Routes
app.get('/api/proxy/:email', (req, res) => {
    const { email } = req.params;
    const proxy = db.prepare('SELECT * FROM proxies WHERE email = ?').get(email);
    
    if (!proxy) {
        return res.status(404).json({ error: 'No proxy found for this email' });
    }
    
    res.json(proxy);
});

app.post('/api/proxy/:email/rotate', (req, res) => {
    const { email } = req.params;
    const { reason } = req.body;
    
    // Get current proxy
    const currentProxy = db.prepare('SELECT * FROM proxies WHERE email = ?').get(email);
    
    // Get a new free proxy
    const newProxy = db.prepare('SELECT * FROM proxies WHERE is_used = 0 AND is_active = 1 LIMIT 1').get();
    
    if (!newProxy) {
        return res.status(404).json({ error: 'No free proxies available' });
    }
    
    // Start transaction
    const transaction = db.transaction(() => {
        // Free up old proxy if exists
        if (currentProxy) {
            db.prepare('UPDATE proxies SET is_used = 0, email = NULL, is_active = 0 WHERE id = ?')
                .run(currentProxy.id);
        }
        
        // Assign new proxy
        db.prepare('UPDATE proxies SET is_used = 1, email = ? WHERE id = ?')
            .run(email, newProxy.id);
        
        // Add to history
        db.prepare('INSERT INTO proxy_history (email, proxy_id, reason) VALUES (?, ?, ?)')
            .run(email, newProxy.id, reason);
    });
    
    transaction();
    
    res.json({ message: 'Proxy rotated successfully', proxy: newProxy });
});

app.get('/api/proxy/:email/history', (req, res) => {
    const { email } = req.params;
    const history = db.prepare(`
        SELECT ph.*, p.host, p.port 
        FROM proxy_history ph 
        JOIN proxies p ON ph.proxy_id = p.id 
        WHERE ph.email = ? 
        ORDER BY ph.created_at DESC
    `).all(email);
    
    res.json(history);
});

// Admin Panel Routes
app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/api/admin/proxies', adminAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const proxies = db.prepare(`
        SELECT * FROM proxies 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM proxies').get().count;
    const hasMore = offset + proxies.length < total;

    res.json({ proxies, hasMore });
});

app.post('/api/admin/proxies', adminAuth, (req, res) => {
    const { host, port, username, password } = req.body;
    
    // Check for duplicates
    const existingProxy = db.prepare('SELECT * FROM proxies WHERE host = ? AND port = ?').get(host, port);
    if (existingProxy) {
        return res.status(400).json({ error: 'Proxy already exists' });
    }
    
    const result = db.prepare(`
        INSERT INTO proxies (host, port, username, password)
        VALUES (?, ?, ?, ?)
    `).run(host, port, username, password);

    // Immediately check status of the newly added proxy
    checkProxyStatus([result.lastInsertRowid]);
    
    res.json({ id: result.lastInsertRowid });
});

app.post('/api/admin/proxies/bulk', adminAuth, (req, res) => {
    const { proxies } = req.body;
    
    let added = 0;
    let skipped = 0;
    let addedIds = [];
    
    const transaction = db.transaction((proxies) => {
        for (const proxy of proxies) {
            // Check for duplicates
            const existingProxy = db.prepare('SELECT * FROM proxies WHERE host = ? AND port = ?')
                .get(proxy.host, proxy.port);
            
            if (existingProxy) {
                skipped++;
                continue;
            }
            
            // Add new proxy
            const result = db.prepare(`
                INSERT INTO proxies (host, port, username, password)
                VALUES (?, ?, ?, ?)
            `).run(proxy.host, proxy.port, proxy.username, proxy.password);
            
            added++;
            addedIds.push(result.lastInsertRowid);
        }
    });
    
    transaction(proxies);

    // Immediately check status of the newly added proxies
    if (addedIds.length > 0) {
        checkProxyStatus(addedIds);
    }
    
    res.json({ added, skipped });
});

app.post('/api/admin/proxies/:email/rotate', adminAuth, (req, res) => {
    const { email } = req.params;
    const { reason } = req.body;
    
    // Reuse the existing rotate endpoint logic
    const newProxy = db.prepare('SELECT * FROM proxies WHERE is_used = 0 AND is_active = 1 LIMIT 1').get();
    
    if (!newProxy) {
        return res.status(404).json({ error: 'No free proxies available' });
    }
    
    const transaction = db.transaction(() => {
        const currentProxy = db.prepare('SELECT * FROM proxies WHERE email = ?').get(email);
        
        if (currentProxy) {
            db.prepare('UPDATE proxies SET is_used = 0, email = NULL, is_active = 0 WHERE id = ?')
                .run(currentProxy.id);
        }
        
        db.prepare('UPDATE proxies SET is_used = 1, email = ? WHERE id = ?')
            .run(email, newProxy.id);
        
        db.prepare('INSERT INTO proxy_history (email, proxy_id, reason) VALUES (?, ?, ?)')
            .run(email, newProxy.id, reason || 'Manual rotation by admin');
    });
    
    transaction();
    
    res.json({ message: 'Proxy rotated successfully', proxy: newProxy });
});

// Add endpoint for rotation history
app.get('/api/admin/rotation-history', adminAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const history = db.prepare(`
        SELECT ph.*, p.host, p.port, p.email as current_email
        FROM proxy_history ph 
        JOIN proxies p ON ph.proxy_id = p.id 
        ORDER BY ph.created_at DESC
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM proxy_history').get().count;
    const hasMore = offset + history.length < total;

    res.json({ history, hasMore });
});

// Add endpoint for updating proxy
app.put('/api/admin/proxies/:id', adminAuth, (req, res) => {
    const { id } = req.params;
    const { host, port, username, password } = req.body;
    
    // Check if proxy exists
    const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id);
    if (!proxy) {
        return res.status(404).json({ error: 'Proxy not found' });
    }
    
    // Check for duplicates (excluding current proxy)
    const existingProxy = db.prepare('SELECT * FROM proxies WHERE host = ? AND port = ? AND id != ?')
        .get(host, port, id);
    if (existingProxy) {
        return res.status(400).json({ error: 'Proxy with this host and port already exists' });
    }
    
    db.prepare(`
        UPDATE proxies 
        SET host = ?, port = ?, username = ?, password = ?
        WHERE id = ?
    `).run(host, port, username, password, id);
    
    res.json({ message: 'Proxy updated successfully' });
});

// Add endpoint for deleting proxy
app.delete('/api/admin/proxies/:id', adminAuth, (req, res) => {
    const { id } = req.params;
    
    // Check if proxy exists
    const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id);
    if (!proxy) {
        return res.status(404).json({ error: 'Proxy not found' });
    }
    
    // Check if proxy is in use
    if (proxy.is_used) {
        return res.status(400).json({ error: 'Cannot delete proxy that is currently in use' });
    }
    
    db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
    
    res.json({ message: 'Proxy deleted successfully' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 