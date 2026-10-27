const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files serve karein, lekin public/index.html ko direct default mat banayein
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(session({
    secret: 'hunar_hub_secure_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Root route par check karein ki user logged in hai ya nahi
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        // Agar login hai, toh main index.html dikhayein
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        // Agar login nahi hai, toh seedha login page par bhej dein
        res.redirect('/login.html');
    }
});

// Middleware
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'Unauthorized. Please login.' });
}

function requireRole(role) {
    return (req, res, next) => {
        if (req.session && req.session.user && req.session.user.role === role) return next();
        res.status(403).json({ error: 'Forbidden: Access denied.' });
    };
}

// ==================== AUTH APIs ====================
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    if (!['customer', 'worker'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
            [name, email, hashedPassword, role], function (err) {
                if (err) return res.status(400).json({ error: 'Email already registered.' });
                const userId = this.lastID;
                if (role === 'worker') {
                    db.run(`INSERT INTO worker_profiles (user_id, category_id, skills, experience, description, locality, service_area, price) VALUES (?, 1, 'General Service', 1, 'Professional service provider', 'Main City', 'All Areas', 299)`, [userId]);
                }
                res.json({ success: true, message: 'Registration successful! Please login.' });
            });
    } catch (err) {
        res.status(500).json({ error: 'Server error during registration.' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid email or password.' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

        req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
        res.json({ success: true, user: req.session.user });
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
    if (req.session && req.session.user) res.json({ user: req.session.user });
    else res.status(401).json({ user: null });
});

// ==================== CATEGORIES API ====================
app.get('/api/categories', isAuthenticated, (req, res) => {
    db.all(`SELECT * FROM service_categories WHERE status = 'active'`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch categories.' });
        res.json(rows);
    });
});

// ==================== WORKERS API ====================
app.get('/api/workers', isAuthenticated, (req, res) => {
    let query = `
    SELECT worker_profiles.*, users.name as worker_name, users.email as worker_email, service_categories.name as category_name,
    (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE reviews.worker_id = users.id) as avg_rating,
    (SELECT COUNT(*) FROM reviews WHERE reviews.worker_id = users.id) as review_count
    FROM worker_profiles 
    JOIN users ON worker_profiles.user_id = users.id 
    JOIN service_categories ON worker_profiles.category_id = service_categories.id
    WHERE 1=1
  `;
    let params = [];

    if (req.query.category_id) {
        query += ` AND worker_profiles.category_id = ?`;
        params.push(req.query.category_id);
    }
    if (req.query.locality) {
        query += ` AND worker_profiles.locality LIKE ?`;
        params.push(`%${req.query.locality}%`);
    }
    if (req.query.search) {
        query += ` AND (users.name LIKE ? OR worker_profiles.skills LIKE ? OR service_categories.name LIKE ?)`;
        const term = `%${req.query.search}%`;
        params.push(term, term, term);
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch workers.' });
        res.json(rows);
    });
});

app.get('/api/workers/:id', isAuthenticated, (req, res) => {
    const workerId = req.params.id;
    const query = `
    SELECT worker_profiles.*, users.name as worker_name, users.email as worker_email, service_categories.name as category_name,
    (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE reviews.worker_id = users.id) as avg_rating,
    (SELECT COUNT(*) FROM reviews WHERE reviews.worker_id = users.id) as review_count
    FROM worker_profiles 
    JOIN users ON worker_profiles.user_id = users.id 
    JOIN service_categories ON worker_profiles.category_id = service_categories.id
    WHERE users.id = ?
  `;
    db.get(query, [workerId], (err, worker) => {
        if (err || !worker) return res.status(404).json({ error: 'Worker not found.' });

        db.all(`SELECT reviews.*, users.name as customer_name FROM reviews JOIN users ON reviews.customer_id = users.id WHERE reviews.worker_id = ?`, [workerId], (err2, reviews) => {
            worker.reviews = reviews || [];
            res.json(worker);
        });
    });
});

app.get('/api/worker/profile', isAuthenticated, requireRole('worker'), (req, res) => {
    db.get(`SELECT worker_profiles.*, users.name, users.email FROM worker_profiles JOIN users ON worker_profiles.user_id = users.id WHERE users.id = ?`, [req.session.user.id], (err, profile) => {
        if (err || !profile) return res.status(404).json({ error: 'Profile not found.' });
        res.json(profile);
    });
});

app.put('/api/worker/profile', isAuthenticated, requireRole('worker'), (req, res) => {
    const { category_id, skills, experience, description, locality, service_area, price, pricing_unit, availability } = req.body;
    db.run(`UPDATE worker_profiles SET category_id = ?, skills = ?, experience = ?, description = ?, locality = ?, service_area = ?, price = ?, pricing_unit = ?, availability = ? WHERE user_id = ?`,
        [category_id, skills, experience, description, locality, service_area, price, pricing_unit, availability, req.session.user.id], (err) => {
            if (err) return res.status(500).json({ error: 'Failed to update profile.' });
            res.json({ success: true, message: 'Profile updated successfully!' });
        });
});

// ==================== BOOKINGS API ====================
app.post('/api/bookings', isAuthenticated, requireRole('customer'), (req, res) => {
    const { worker_id, service_date, service_time, address, work_description } = req.body;
    if (!worker_id || !service_date || !service_time || !address || !work_description) {
        return res.status(400).json({ error: 'All booking fields are required.' });
    }

    db.run(`INSERT INTO bookings (customer_id, worker_id, service_date, service_time, address, work_description, status) VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
        [req.session.user.id, worker_id, service_date, service_time, address, work_description], function (err) {
            if (err) return res.status(500).json({ error: 'Failed to create booking request.' });
            res.json({ success: true, bookingId: this.lastID, message: 'Booking request submitted successfully!' });
        });
});

app.get('/api/bookings/customer', isAuthenticated, requireRole('customer'), (req, res) => {
    const query = `
    SELECT bookings.*, users.name as worker_name, service_categories.name as category_name, worker_profiles.price, worker_profiles.pricing_unit
    FROM bookings
    JOIN users ON bookings.worker_id = users.id
    JOIN worker_profiles ON users.id = worker_profiles.user_id
    JOIN service_categories ON worker_profiles.category_id = service_categories.id
    WHERE bookings.customer_id = ?
    ORDER BY bookings.created_at DESC
  `;
    db.all(query, [req.session.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch bookings.' });
        res.json(rows);
    });
});

app.get('/api/bookings/worker', isAuthenticated, requireRole('worker'), (req, res) => {
    const query = `
    SELECT bookings.*, users.name as customer_name, users.email as customer_email
    FROM bookings
    JOIN users ON bookings.customer_id = users.id
    WHERE bookings.worker_id = ?
    ORDER BY bookings.created_at DESC
  `;
    db.all(query, [req.session.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch bookings.' });
        res.json(rows);
    });
});

app.patch('/api/bookings/:id/status', isAuthenticated, (req, res) => {
    const bookingId = req.params.id;
    const { status } = req.body;
    const validStatuses = ['Accepted', 'Rejected', 'In Progress', 'Completed', 'Cancelled'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status update.' });
    }

    db.get(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, booking) => {
        if (err || !booking) return res.status(404).json({ error: 'Booking not found.' });

        if (req.session.user.role === 'worker' && booking.worker_id !== req.session.user.id) {
            return res.status(403).json({ error: 'Unauthorized.' });
        }
        if (req.session.user.role === 'customer' && booking.customer_id !== req.session.user.id && status !== 'Cancelled') {
            return res.status(403).json({ error: 'Unauthorized.' });
        }

        db.run(`UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, bookingId], (err2) => {
            if (err2) return res.status(500).json({ error: 'Failed to update booking status.' });
            res.json({ success: true, message: `Booking status updated to ${status}.` });
        });
    });
});

// ==================== REVIEWS API ====================
app.post('/api/bookings/:id/review', isAuthenticated, requireRole('customer'), (req, res) => {
    const bookingId = req.params.id;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Valid rating between 1 and 5 is required.' });
    }

    db.get(`SELECT * FROM bookings WHERE id = ? AND customer_id = ?`, [bookingId, req.session.user.id], (err, booking) => {
        if (err || !booking) return res.status(404).json({ error: 'Booking not found.' });
        if (booking.status !== 'Completed') {
            return res.status(400).json({ error: 'You can only review completed services.' });
        }

        db.run(`INSERT INTO reviews (booking_id, customer_id, worker_id, rating, comment) VALUES (?, ?, ?, ?, ?)`,
            [bookingId, req.session.user.id, booking.worker_id, rating, comment], function (err2) {
                if (err2) return res.status(400).json({ error: 'Review already submitted for this booking.' });
                res.json({ success: true, message: 'Review submitted successfully!' });
            });
    });
});

// ==================== ADMIN STATS & MANAGEMENT APIs ====================
app.get('/api/admin/stats', isAuthenticated, requireRole('admin'), (req, res) => {
    db.get(`SELECT 
    (SELECT COUNT(*) FROM users WHERE role='customer') as customer_count,
    (SELECT COUNT(*) FROM users WHERE role='worker') as worker_count,
    (SELECT COUNT(*) FROM bookings) as booking_count`, (err, stats) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch stats' });
        res.json(stats);
    });
});

app.get('/api/admin/bookings', isAuthenticated, requireRole('admin'), (req, res) => {
    db.all(`SELECT bookings.*, c.name as customer_name, w.name as worker_name FROM bookings JOIN users c ON bookings.customer_id = c.id JOIN users w ON bookings.worker_id = w.id ORDER BY bookings.created_at DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch all bookings' });
        res.json(rows);
    });
});

// Get all users for admin management
app.get('/api/admin/users', isAuthenticated, requireRole('admin'), (req, res) => {
    db.all(`SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch users' });
        res.json(rows);
    });
});

// Delete User/Worker (Admin Only)
app.delete('/api/admin/users/:id', isAuthenticated, requireRole('admin'), (req, res) => {
    const userId = req.params.id;

    db.serialize(() => {
        // 1. Worker profile delete karo
        db.run(`DELETE FROM worker_profiles WHERE user_id = ?`, [userId], (err) => {
            if (err) console.error('Error deleting worker profile:', err.message);
        });

        // 2. Bookings delete karo
        db.run(`DELETE FROM bookings WHERE customer_id = ? OR worker_id = ?`, [userId, userId], (err) => {
            if (err) console.error('Error deleting bookings:', err.message);
        });

        // 3. User main table se delete karo
        db.run(`DELETE FROM users WHERE id = ?`, [userId], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete user' });
            }
            res.json({ message: 'User and all associated profiles deleted successfully' });
        });
    });
});

// ==================== PAGE ROUTES ====================
app.get('/customer-dashboard.html', isAuthenticated, requireRole('customer'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'customer-dashboard.html'));
});

app.get('/worker-dashboard.html', isAuthenticated, requireRole('worker'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'worker-dashboard.html'));
});

app.get('/worker-profile.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'worker-profile.html'));
});

app.get('/admin-dashboard.html', isAuthenticated, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Hunar Hub server running at http://localhost:${PORT}`);
});