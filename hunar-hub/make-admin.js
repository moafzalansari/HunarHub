const db = require('./database');

// Yahan apna registered email dalo
const targetEmail = 'insa123@gmail.com'; 

db.run(`UPDATE users SET role = 'admin' WHERE email = ?`, [targetEmail], function(err) {
    if (err) {
        console.error('Error:', err.message);
    } else {
        console.log(`Success! ${targetEmail} is now an Admin.`);
    }
    process.exit();
});