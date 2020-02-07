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
        var context = {
            _info: "This is a mock canvas context",
            _kind: kind,
            createBuffer: function () { count++; return "mock buffer object " + count; },
            createProgram: function () { count++; return "mock program object " + count; },
            createShader: function (t) { count++; return "" + t + " mock shader " + count; },
            shaderSource: function () { count++; return "mock shader source " + count; },
            compileShader: function () { count++; return "mock compile shader " + count; },
            linkProgram: function () { count++; return "mock link program " + count; },
            getShaderParameter: function () { return (!options.fail_compile); },
            getProgramParameter: function () { return (!options.fail_link); },
            attachShader: function () { count++; return "mock attach shader " + count; },
            getShaderInfoLog: function () { count++; return "mock shader log " + count; },
            bindBuffer: function () { count++; return "mock bind buffer " + count; },
            bufferData: function () { count++; return "mock buffer data " + count; },
            transformFeedbackVaryings: function () { count++; return "mock feedback varyings " + count; },
            getAttribLocation: function () { count++; return "mock get attrib location " + count; },
            enableVertexAttribArray: function () { count++; return "mock enable vertex attrib arr " + count; },
            vertexAttribPointer: function () { count++; return "mock vertex attrib pointer" + count; },
            vertexAttribDivisor: function () { count++; return "mock vert attr div " + count; },
            getUniformLocation: function () { count++; return "mock get uniform loc " + count; },
            useProgram: function () { count++; return "mock use program " + count; },
            VERTEX_SHADER: "VS",
            FRAGMENT_SHADER: "FS",
            ARRAY_BUFFER: "AB",
            DYNAMIC_COPY: "DC",
        };
        var ukind = {"uniformMatrix":1, "uniform": 2};
        var ucount = {"1": 1, "2": 2, "3": 3, "4":4};
        var utype = {"f": 1, "i": 2, "u":3};
        // this defines too many matrix setters, but whatever
        var method;
        for (var k in ukind) {
            for (var c in ucount) {
                for (var t in utype) {
                    method = k + c + t + "v";
                    context[method] = function () { count++; return "mock uniform setter " + count; };
                    //if (options.dump_methods) {
                    //    console.log("method: " + method);
                    //}
                }
            }
        }
        return context;
    }

    window.HTMLCanvasElement.prototype.toDataURL = function () {
        return "";
    }
}

global.mockCanvas = mockCanvas;