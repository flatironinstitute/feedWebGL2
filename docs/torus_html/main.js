var info = $('#info');
//var canvas_div = null;
var element = null;
var volume = null;
var metadata_path = null;
var binary_path = null;
var json_data = null;
var binary_data = null;
var default_width = 1200;

var setup = function (mpath, bpath) {
    debugger;
    metadata_path = mpath;
    binary_path = bpath;
    info.html('loading metadata JSON.');
    element = $('#VolumeTarget');
    element.empty();
    $.getJSON(metadata_path, process_json).fail(on_json_load_failure);
};

var on_json_load_failure = function() {
    alert("Could not load local JSON data.\n" + metadata_path +
            "\n You may need to run a web server to avoid cross origin restrictions.")
};

var on_binary_load_failure = function() {
    alert("Could not load local binary data.\n" + binary_path + 
            "\n You may need to run a web server to avoid cross origin restrictions.")
};

var process_json = function(data) {
    json_data = data;
    info.html("json data read.");
    var request = new XMLHttpRequest();
    request.open('GET', binary_path, true);
    request.responseType = 'blob';
    request.onload = function() {
        info.html("Binary loaded: " + binary_path);
        var reader = new FileReader();
        reader.readAsArrayBuffer(request.response);
        //reader.readAsDataURL(request.response);
        reader.onload =  function(a){
            info.html("Converting binary data: " + binary_path);
            binary_data = new Float32Array(reader.result);
            create_volume_viz();
        };
    };
    request.onerror = on_binary_load_failure;
    request.send();
};

var create_volume_viz = function () {
    debugger;
    info.html("creating visualization.")
    var options = json_data;  // copy ?
    var width = options.width || default_width;
    volume = element.marching_cubes32(options);
    volume.buffer = binary_data;
    element.V_container = $("<div/>").appendTo(element);
    volume.build_scaffolding(element.V_container, width);
    //volume.wires_check.prop("checked", true);
    //volume.focus_volume();
};

info.html('main.js loaded.');
