const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const Database = require('better-sqlite3');

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
        email TEXT
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
    const newProxy = db.prepare('SELECT * FROM proxies WHERE is_used = 0 LIMIT 1').get();
    
    if (!newProxy) {
        return res.status(404).json({ error: 'No free proxies available' });
    }
    
    // Start transaction
    const transaction = db.transaction(() => {
        // Free up old proxy if exists
        if (currentProxy) {
            db.prepare('UPDATE proxies SET is_used = 0, email = NULL WHERE id = ?')
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
    const proxies = db.prepare('SELECT * FROM proxies').all();
    res.json(proxies);
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
    
    res.json({ id: result.lastInsertRowid });
});

app.post('/api/admin/proxies/bulk', adminAuth, (req, res) => {
    const { proxies } = req.body;
    
    let added = 0;
    let skipped = 0;
    
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
            db.prepare(`
                INSERT INTO proxies (host, port, username, password)
                VALUES (?, ?, ?, ?)
            `).run(proxy.host, proxy.port, proxy.username, proxy.password);
            
            added++;
        }
    });
    
    transaction(proxies);
    
    res.json({ added, skipped });
});

app.post('/api/admin/proxies/:email/rotate', adminAuth, (req, res) => {
    const { email } = req.params;
    const { reason } = req.body;
    
    // Reuse the existing rotate endpoint logic
    const newProxy = db.prepare('SELECT * FROM proxies WHERE is_used = 0 LIMIT 1').get();
    
    if (!newProxy) {
        return res.status(404).json({ error: 'No free proxies available' });
    }
    
    const transaction = db.transaction(() => {
        const currentProxy = db.prepare('SELECT * FROM proxies WHERE email = ?').get(email);
        
        if (currentProxy) {
            db.prepare('UPDATE proxies SET is_used = 0, email = NULL WHERE id = ?')
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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 