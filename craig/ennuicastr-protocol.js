/*
 * Copyright (c) 2018 Yahweasel
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

            "login": 0x10,
            "info": 0x11,

            "ping": 0x20,
            "pong": 0x21,

            "data": 0x30
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
            }
        },

        "flags": {
            "connectionTypeMask": 0xF,
            "connectionType": {
                "ping": 0x0,
                "data": 0x1,
                "monitor": 0x8
            },
            "dataTypeMask": 0xF0,
            "dataType": {
                "opus": 0x00,
                "flac": 0x10
            }
        },

        "info": {
            "sampleRate": 0
        }
    };

    if (typeof process !== "undefined")
        module.exports = EnnuiCastrProtocol;
    else if (typeof window !== "undefined")
        window.EnnuiCastrProtocol = EnnuiCastrProtocol;
})();
