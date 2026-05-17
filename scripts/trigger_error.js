import http from 'http';

const url = 'http://127.0.0.1:5000/api/employees?page=1&limit=10&search=&department=&status=';

console.log('Triggering GET', url);

http.get(url, (res) => {
    console.log('Status Base:', res.statusCode);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Body:', data);
    });
}).on('error', (err) => {
    console.error('Request Error:', err.message);
});
