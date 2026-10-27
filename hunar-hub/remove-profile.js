const db = require('./database');

db.run(`DELETE FROM worker_profiles WHERE user_id IN (SELECT id FROM users WHERE email = 'insa123@gmail.com')`, [], (err) => {
    if (err) console.error('Error:', err.message);
    else console.log('Worker profile removed successfully!');
    process.exit();
});