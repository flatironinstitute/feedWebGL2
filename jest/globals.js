// Shared test globals.

// Require jQuery only if needed.
if (!global.jQuery) {
    global.jQuery = require('jquery');
}


function mockCanvas (window) {
    var count = 0;
    var imgdata = function(w, h) {
        var length = w * h * 4;
        var result = new Array(length);
        for (var i=0; i<length; i++) {
            result[i] = 0;
        }
        return result;
    }
    window.HTMLCanvasElement.prototype.getContext = function (kind) {
        return {
            _info: "This is a mock canvas context",
            _kind: kind,
            createBuffer: function () { count++; return "mock buffer object " + count; },
            createProgram: function () { count++; return "mock program object " + count; },
        };
    }

    window.HTMLCanvasElement.prototype.toDataURL = function () {
        return "";
    }
}

global.mockCanvas = mockCanvas;