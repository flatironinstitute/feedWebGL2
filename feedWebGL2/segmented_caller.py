"""
Support for large data transfers in widget calls.
"""

# XXXX someday move this logic (refactored) to jp_proxy_widget main module.

from jupyter_ui_poll import run_ui_poll_loop
from jp_proxy_widget.hex_codec import hex_to_bytearray, bytearray_to_hex
import json

DEFAULT_CHUNK_SIZE = 10000000


def get_or_make_caller(widget):
    if not hasattr(widget, "_segmented_caller"):
        widget._segmented_caller = SegmentedCallManager(widget)
    return widget._segmented_caller

def get_string(widget, callable, chunk_size=DEFAULT_CHUNK_SIZE, *arguments):
    caller = get_or_make_caller(widget)
    return caller.get_string(callable, chunk_size, arguments)

def get_json(widget, callable, chunk_size=DEFAULT_CHUNK_SIZE, *arguments):
    caller = get_or_make_caller(widget)
    return caller.get_json(callable, chunk_size, arguments)

def get_bytes(widget, callable, chunk_size=DEFAULT_CHUNK_SIZE, *arguments):
    caller = get_or_make_caller(widget)
    return caller.get_hex(callable, chunk_size, arguments)

JS_SUPPORT = """
// xxxx this should be shared among all widgets xxxx

const FORMAT_STRING = "string";
const FORMAT_JSON = "json";
const FORMAT_HEX = "hex";

class SegmentedCallReceiver {
    constructor (send_chunk_callback, error_callback) {
        this.send_chunk_callback = send_chunk_callback;
        this.error_callback = error_callback;
        this.reset();
    };
    reset() {
        this.sending_data = null;
        this.sending_index = null;
        this.chunk_size = null;
        //this.send_chunk_callback = null;
        //this.error_callback = null;
        this.active = false;
    };
    call_and_start_sending(callable, args, chunk_size, format) {
        if (this.active) {
            var error = "caller is active -- cannot restart";
            error_callback(error);
            throw new Error(error);
        }
        this.chunk_size = chunk_size;
        this.send_chunk_callback = send_chunk_callback;
        //this.error_callback = error_callback;
        var data = null;
        try {
            data = callable(...args);
        } catch (e) {
            error_callback("call exception: " + e);
            throw e;
        }
        if (format == FORMAT_STRING) {
            // do nothing: leave data as a string
        } else if (format == FORMAT_JSON) {
            try {
                data = JSON.stringify(data);
            } catch (e) {
                error_callback("json conversion failed: " + e);
                throw e;
            }
        } else if (format == FORMAT_HEX) {
            try {
                data = this.to_hex(data);
            } catch (e) {
                error_callback("hex conversion failed: " + e);
                throw e;
            }
        } else {
            throw new Error("unknown format: " + format);
        }
        var tdata = (typeof data);
        if ( tdata != "string") {
            var error = "return value must be json converted or string or hex converted " + tdata;
            error_callback(error);
            throw new Error(error);
        }
        this.sending_data = data;
        this.sending_index = 0;
        this.active = true;
        this.send_chunk_callback = send_chunk_callback;
        this.error_callback = error_callback;
        return this.get_chunk();
    };
    get_chunk() {
        if (!this.active) {
            var error = "SegmentCallReciever is not active, canmnot send";
            error_callback(error);
            throw new Error(error);
        }
        var data = this.sending_data;
        var index = this.sending_index;
        if (index >= data.length) {
            this.reset();
            this.send_chunk_callback(null);
            return null;
        }
        var end = index + this.chunk_size;
        var chunk = data.slice(index, end);
        this.sending_index = end;
        this.send_chunk_callback(chunk);
        return chunk;
    };

    // pasted from jp_proxy_widget/.../proxy_implementation.js
    to_hex(int8) {
        var length = int8.length;
        var hex_array = Array(length);
        for (var i=0; i<length; i++) {
            var b = int8[i];
            var h = b.toString(16);
            var ln = h.length;
            if (ln==1) {
                h = "0" + h
            } else if (ln==2) {
                // use h unmodified
            } else {
                throw new Error("invalid byte value: " + h);
            }
            hex_array[i] = h;;
        }
        return hex_array.join("");
    };

    from_hex(hexstr) {
        var length2 = hexstr.length;
        if ((length2 % 2) != 0) {
            throw "hex string length must be multiple of length 2";
        }
        var length = length2 / 2;
        var result = new Uint8Array(length);
        for (var i=0; i<length; i++) {
            var i2 = 2 * i;
            var h = hexstr.substring(i2, i2+2);
            var b = parseInt(h, 16);
            result[i] = b;
        }
        return;
    };
};

element._segmented_call_receiver = new SegmentedCallReceiver(send_chunk_callback, error_callback);
"""

class SegmentedCallError(ValueError):
    "Error in segmented call."

FORMAT_STRING = "string"
FORMAT_JSON = "json"
FORMAT_HEX = "hex"

class SegmentedCallManager:
    "State manager for segmented call loop."
    # xxxx need to add better error handling.
    # Javascript errors can cause Python kernel to hang until interrupt.

    def __init__(self, widget):
        self.widget = widget
        widget.js_init(
            JS_SUPPORT,
            send_chunk_callback=self.send_chunk_callback,
            error_callback=self.error_callback,
        )
        self.error = None
        self.accumulated_response = None
        self.receiving_format = FORMAT_STRING
        self.collecting = False
    def get_string(self, callable, chunk_size=DEFAULT_CHUNK_SIZE, arguments=(), format=FORMAT_STRING):
        self.receiving_format = format
        return self.collect_sends(callable, arguments, chunk_size, format)
    def get_json(self, callable, chunk_size=DEFAULT_CHUNK_SIZE, arguments=()):
        return self.get_string(callable, chunk_size, arguments, format=FORMAT_JSON)
    def get_hex(self, callable, chunk_size=DEFAULT_CHUNK_SIZE, arguments=()):
        return self.get_string(callable, chunk_size, arguments, format=FORMAT_HEX)
    def collect_sends(self, callable, arguments, chunk_size, receiving_format):
        self.reset_error_state()
        self.accumulated_response = []
        self.collecting = True
        arguments = list(arguments)
        # ("calling", callable, arguments, chunk_size, as_json)
        self.widget.element._segmented_call_receiver.call_and_start_sending(
            callable,
            arguments,
            chunk_size,
            receiving_format)
        #self.widget.element._segmented_call_receiver.get_chunk() # implicit
        run_ui_poll_loop(self.poll_is_finished)
        #("after poll", self.collecting, self.accumulated_response)
        all_data = "".join(self.accumulated_response)
        #if as_json:
        #    all_data = json.loads(all_data)
        converted = self.convert_data(all_data, receiving_format)
        return converted
    def convert_data(self, data, format):
        if format == FORMAT_STRING:
            return data
        if format == FORMAT_JSON:
            return json.loads(data)
        if format == FORMAT_HEX:
            #print("got hex", data)
            return hex_to_bytearray(data)
        raise ValueError("unknown format: " + repr(format))
    def poll_is_finished(self):
        if self.collecting:
            return None
        else:
            return self.accumulated_response
    def send_chunk_callback(self, chunk):
        assert self.collecting, "Send chunk should not be called when not collecting."
        if (chunk):
            self.accumulated_response.append(chunk)
            #self.widget.element.html("got chunk: " + str(len(self.accumulated_response)))
            # get the next chunk
            self.widget.element._segmented_call_receiver.get_chunk()
        else:
            #self.widget.element.html("last chunk: " + str(len(self.accumulated_response)))
            self.collecting = False
    def error_callback(self, description):
        self.error = description
        raise SegmentedCallError(description)
    def reset_error_state(self):
        self.widget.element._segmented_call_receiver.reset()
        self.error = None

def test_in_jupyter():
    from IPython.display import HTML, display, Image
    import jp_proxy_widget
    greeter = jp_proxy_widget.JSProxyWidget()
    # widget must be displayed before calling get_*
    display(greeter)
    greeter.element.html("<h2>Hello world</h2>")
    greeter.js_init("""
    element.string_function = function() {
        return "this is a string";
    };
    element.json_function = function() {
        return {text: "this is a string in json"};
    };
    element.bytes_function = function () {
        return [4,6,8,211];
    }
    """)
    test1 = get_string(greeter, greeter.element.string_function, chunk_size=3)
    test2 = get_json(greeter, greeter.element.json_function, chunk_size=3)
    test3 = list(get_bytes(greeter, greeter.element.bytes_function, chunk_size=3))
    greeter.element.html("<h2>segmented json call %s'</h2>" % repr((test1, test2, test3)))
    return greeter
