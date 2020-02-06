// Shared test globals.

// Require jQuery only if needed.
if (!global.jQuery) {
    global.jQuery = require('jquery');
}


function mockCanvas (window, options) {
    options = options || {};
    var fail_compile = options.fail_compile || false;
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
            createShader: function (t) { count++; return "" + t + " mock shader " + count; },
            shaderSource: function () { count++; return "mock shader source " + count; },
            compileShader: function () { count++; return "mock compile shader " + count; },
            getShaderParameter: function () { return (!options.fail_compile); },
            attachShader: function () { count++; return "mock attach shader " + count; },
            getShaderInfoLog: function () { count++; return "mock shader log " + count; },
            VERTEX_SHADER: "VS",
            FRAGMENT_SHADER: "FS",
        };
    }

    window.HTMLCanvasElement.prototype.toDataURL = function () {
        return "";
    }
}

global.mockCanvas = mockCanvas;