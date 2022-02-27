import net from 'net';
import tls from 'tls';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import { Database } from './db.js';

import { StringDecoder } from 'string_decoder';
import parser from 'http-string-parser';
import queryParser from 'query-string';

import { app } from './api.js';



const decoder = new StringDecoder('utf-8');

const certs = {};
fs.readdirSync('certs/').forEach(file => {
    certs[file.substring(0, file.length - 4)] = fs.readFileSync('certs/' + file)
});

const key = fs.readFileSync('selfsigned.key');
const cert = fs.readFileSync('selfsigned.crt');

function createSecureContext(cert) {
    return tls.createSecureContext({
        key: key,
        cert: cert
    })
}

function generateCert(servername, cb) {
    let gen_cert = spawn('./gen_cert.sh', [servername, Math.floor(Math.random() * 1000000000000)]);

    gen_cert.stdout.once('data', (data) => {
        certs[servername] = data;
        let ctx = createSecureContext(data);
        cb(null, ctx);
        fs.writeFile(`certs/${servername}.crt`, data, (err) => {
            if (err) {
                console.log(err.message)
            }
        })
    });
}

function SNICallback(servername, cb) {
    if (servername in certs) {
        let ctx = createSecureContext(certs[servername]);
        cb(null, ctx)
    } else {
        generateCert(servername, cb)
    }
}

async function parseRequest(data, isSecure, host) {
    const request = parser.parseRequest(new String(data));
    const path = request.uri.split('?')[0];
    const params = JSON.stringify(queryParser.parse(request.uri.split('?')[1]));
    const cookies = request.headers.cookie ? JSON.stringify(request.headers.cookie) : '';
    delete request.headers.cookie;
    const id = await Database.insertRequest(request.method, path, 
        JSON.stringify(request.headers), cookies, params, request.body, isSecure, host);
    return id;
}

function parseResponse(requestId, data) {
    const response = parser.parseResponse(new String(data));
    if (response.statusCode) {
        Database.insertResponse(requestId, response.statusCode, response.statusMessage, 
            JSON.stringify(response.headers), response.body);
    }
}

function httpMiddleware(req, res) {
    if (req.url.startsWith('http')) {
        const host = req.url.split('/')[2]
        const options = {
            host: host,
            port: 80
        };
        const proxyReq = net.connect(options, async () => {
            const path = req.url.split('/').slice(2).join('/');
            let proxyHeaders = '';
            for (let i = 0; i < req.rawHeaders.length / 2 - 1; ++i) {
                proxyHeaders += `${req.rawHeaders[i * 2]}: ${req.rawHeaders[i * 2 + 1]}\r\n`;
            }
            let data = Buffer.from(`${req.method} ${path} HTTP/1.1\r\n${proxyHeaders}\r\n`);
            const id = await parseRequest(data, false, host);
            proxyReq.write(data);
            req.socket.pipe(proxyReq).pipe(req.socket);
            proxyReq.on('data', (data) => {
                parseResponse(id, data);
            });
        });
        proxyReq.on('error', (e) => {
            console.log(`proxyReq error ${e}`)
        });
    }
}

const server = http.createServer(httpMiddleware);

server.on('connect', (req, clientProxySocket, head) => {
    let serverPort = req.url.split(':')[1];
    let serverHost = req.url.split(':')[0];
    let id;

    let proxyToServerSocket = tls.connect({
        host: serverHost,
        port: serverPort
    }, () => {
    console.log('PROXY TO SERVER SET UP');
    
    clientProxySocket.write('HTTP/1.1 200 Connection established \r\n\n');

    const tlsOptions = {
        key: key,
        cert: cert,
        SNICallback: SNICallback,
        isServer: true
    };

    const tlsSocket = new tls.TLSSocket(clientProxySocket, tlsOptions);
    tlsSocket.on('data', async (data)=> {
        id = await parseRequest(decoder.write(data), true, serverHost);
    });
    tlsSocket.pipe(proxyToServerSocket).pipe(tlsSocket);
    });
    clientProxySocket.on('error', (err) => {
        console.log(err);
    })
    proxyToServerSocket.on('data', (data)=> {
        parseResponse(id, data);
    });
})

server.on('close', () => {
    console.log('Client Disconnected');
});

server.listen(8080, () => {
    console.log('Server running at http://localhost:' + 8080);
});

app.listen(8081, () => {
    console.log('api running at http://localhost:' + 8081);
})