/*
 * Copyright (c) 2018-2020 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/*
 * EnnuiCastr: Multi-user synchronized recording via the web
 *
 * This is the protocol description.
 */

(function() {
    var EnnuiCastrProtocol = {
        "ids": {
            "ack": 0x00,

            // Basic
            "login": 0x10,
            "info": 0x11,
            "error": 0x12,

            // Ping socket
            "ping": 0x20,
            "pong": 0x21,

            // Main data message
            "data": 0x30,

            // Text chat
            "text": 0x31,

            // Monitoring
            "user": 0x40,
            "speech": 0x41,

            // WebRTC signaling info
            "rtc": 0x50,

            // Master
            "mode": 0x60,
        },

        "parts": {
            "ack": {
                "length": 8,
                "ackd": 4
            },

            "login": {
                "length": 16,
                "id": 4,
                "key": 8,
                "flags": 12,
                "nick": 16
            },

            "info": {
                /* Note: Longer for some info */
                "length": 12,
                "key": 4,
                "value": 8
            },

            "ping": {
                "length": 12,
                "clientTime": 4
            },

            "pong": {
                "length": 20,
                "clientTime": 4,
                "serverTime": 12
            },

            "data": {
                "length": 12,
                "granulePos": 4,
                "packet": 12
            },

            "text": {
                "length": 8,
                "reserved": 4,
                "text": 8
            },

            "user": {
                "length": 12,
                "index": 4,
                "status": 8,
                "nick": 12
            },

            "speech": {
                "length": 8,
                "indexStatus": 4
            },

            "rtc": {
                "length": 12,
                "peer": 4,
                "type": 8,
                "value": 12
            },

            "mode": {
                "length": 8,
                "mode": 4
            }
        },

        "flags": {
            "connectionTypeMask": 0xF,
            "connectionType": {
                /* Ping-pong time synchronization is kept on its own connection
                 * to try to avoid interference */
                "ping": 0x0,

                /* The data connection is used for all regular client data
                 * interchange: The client sending voice activity to the
                 * server, the server sending information updates back to the
                 * client, and both sending RTC exchanges to each other. */
                "data": 0x1,

                /* The master connection is used by privileged peers to get
                 * both monitoring information and updates such as credit
                 * costs. It is distinct from the data connection, and
                 * privileged peers should not send voice data over the master
                 * connection. */
                "master": 0x2,

                /* A monitoring connection gets only monitoring info, i.e., who
                 * is speaking at any given time. */
                "monitor": 0x8
            },
            "dataTypeMask": 0xF0,
            "dataType": {
                "opus": 0x00,
                "flac": 0x10
            },
            "featuresMask": 0xFF00,
            "features": {
                "continuous": 0x100,
                "rtc": 0x200
            }
        },

        "info": {
            // C->S, uint32: For FLAC, inform of the sample rate
            "sampleRate": 0,

            // S->C, uint32: Give the client its ID number
            "id": 0x10,

            // S->C, uint32: Inform the client that a peer exists or has connected
            /* It is the role of an initially-connecting peer to start RTC
             * connections, so a client with RTC enabled should respond to
             * peerContinuing by starting the RTC procedure with that peer.
             * peerInitial is purely informative. */
            "peerInitial": 0x11,
            "peerContinuing": 0x12,

            // S->C, uint32: Inform the client of a peer disconnecting
            "peerLost": 0x13,

            // S->C, uint32: Inform the user of the current mode
            "mode": 0x14,

            /* S->C, 2xuint32: Inform the client of the current cost of the
             * recording in credits, and their rate of credit consumption per
             * minute. */
            "creditRate": 0x20,

            /* S->C, 2xuint32: Inform the client of how much credits cost.
             * First int is units of currency (typically cents), second int is
             * units of credits, so they form a ratio. */
            "creditCost": 0x21,

            // S->C, JSON: Give an eligible ICE server for RTC
            "ice": 0x50
        },

        "rtc": {
            // C->S: Give ICE candidate to another peer {id, candidate JSON}
            // S->C: Relay, id replaced by source
            "candidate": 0x0,

            // C->S: Give RTC offer to another peer {id, offer JSON}
            // S->C: Relay, id replaced by source
            "offer": 0x1,

            // C->S: Give RTC answer to another peer {id, answer JSON}
            // S->C: Relay, id replaced by source
            "answer": 0x2
        },

        "mode": {
            // Not yet recording
            "init": 0x00,

            // Recording
            "rec": 0x10,

            /* The recording is finished or paused, but buffers are being
             * emptied. That is, the server is accepting data, but the clients
             * should not be sending *new* data. */
            "buffering": 0x18,

            // Paused (not presently used)
            "paused": 0x20,

            // Finished recording
            "finished": 0x30
        }
    };

    if (typeof process !== "undefined")
        module.exports = EnnuiCastrProtocol;
    else if (typeof window !== "undefined")
        window.EnnuiCastrProtocol = EnnuiCastrProtocol;
})();
