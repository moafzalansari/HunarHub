const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbFile = path.join(__dirname, 'hunarhub.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('customer', 'worker', 'admin')) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

        db.run(`CREATE TABLE IF NOT EXISTS service_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active'
    )`);

        db.run(`CREATE TABLE IF NOT EXISTS worker_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE,
      category_id INTEGER,
      skills TEXT,
      experience INTEGER,
      description TEXT,
      locality TEXT,
      service_area TEXT,
      price REAL,
      pricing_unit TEXT DEFAULT 'Fixed',
      availability TEXT DEFAULT 'Available',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(category_id) REFERENCES service_categories(id)
    )`);

        db.run(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      worker_id INTEGER,
      service_date TEXT NOT NULL,
      service_time TEXT NOT NULL,
      address TEXT NOT NULL,
      work_description TEXT NOT NULL,
      status TEXT CHECK(status IN ('Pending', 'Accepted', 'Rejected', 'In Progress', 'Completed', 'Cancelled')) DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

        db.run(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER UNIQUE,
      customer_id INTEGER,
      worker_id INTEGER,
      rating INTEGER CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
    )`, () => {
            seedInitialData();
        });
    });
}

async function seedInitialData() {
    db.get(`SELECT COUNT(*) as count FROM service_categories`, async (err, row) => {
        if (row.count === 0) {
            console.log('Seeding service categories...');
            const categories = [
                ['Plumbing', 'Leaking taps, pipe repairs, bathroom fittings.', 'wrench'],
                ['Electrical Services', 'Switch repairs, wiring, fan installation.', 'zap'],
                ['AC Repair and Servicing', 'AC gas filling, servicing, cooling issues.', 'wind'],
                ['Carpentry', 'Door repairs, furniture assembly, locks.', 'hammer'],
                ['Home Cleaning', 'Full home deep cleaning, sofa and kitchen cleaning.', 'sparkles'],
                ['Painting', 'Interior and exterior wall painting.', 'home']
            ];
            const stmt = db.prepare(`INSERT INTO service_categories (name, description, icon) VALUES (?, ?, ?)`);
            categories.forEach(cat => stmt.run(cat));
            stmt.finalize();
        }
    });

    db.get(`SELECT COUNT(*) as count FROM users`, async (err, row) => {
        if (row.count === 0) {
            console.log('Seeding rich demo data...');
            const hashedPassword = await bcrypt.hash('password123', 10);

            // Admin
            db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
                ['System Admin', 'admin@hunarhub.com', hashedPassword, 'admin']);

            // Worker 1: Plumber
            db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
                ['Ramesh Plumber', 'plumber@hunarhub.com', hashedPassword, 'worker'], function (err) {
                    if (!err) {
                        db.run(`INSERT INTO worker_profiles (user_id, category_id, skills, experience, description, locality, service_area, price, pricing_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [this.lastID, 1, 'Pipe fitting, Leak fixing, Tap repair', 6, 'Expert plumber with residential & commercial experience.', 'Andheri West', 'Mumbai West', 499, 'Fixed']);
                    }
                });

            // Worker 2: Electrician
            db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
                ['Suresh Electrician', 'electrician@hunarhub.com', hashedPassword, 'worker'], function (err) {
                    if (!err) {
                        db.run(`INSERT INTO worker_profiles (user_id, category_id, skills, experience, description, locality, service_area, price, pricing_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [this.lastID, 2, 'Wiring, MCB repair, Fan & Light fitting', 8, 'Certified senior electrician for all household electrical needs.', 'Bandra East', 'Mumbai Central', 399, 'Fixed']);
                    }
                });

            // Worker 3: AC Technician
            db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
                ['Amit AC Service', 'ac@hunarhub.com', hashedPassword, 'worker'], function (err) {
                    if (!err) {
                        db.run(`INSERT INTO worker_profiles (user_id, category_id, skills, experience, description, locality, service_area, price, pricing_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [this.lastID, 3, 'AC Gas filling, Deep servicing, Cooling repair', 5, 'Specialist in split & window AC repair and maintenance.', 'Powai', 'Mumbai North', 599, 'Fixed']);
                    }
                });

            // Customer
            db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
                ['Priya Customer', 'customer@hunarhub.com', hashedPassword, 'customer']);
        }
    });
}

module.exports = db;