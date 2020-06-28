/*
// jQuery plugin encapsulating a 3d volume viewer
//
// Uses jp_doodle, three.js, feedWebGL2

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/
*/

(function($) {

    $.fn.volume32 = function (options) {
        
        class Volume32 {
            constructor(options) {
                this.settings = $.extend({
                    feedbackContext: null,    // the underlying FeedbackContext context to use
                    valuesArray: null,   // the array buffer of values to contour
                    num_rows: null,
                    num_cols: null,
                    num_layers: 1,  // default to "flat"
                    threshold: 0,  // value at contour
                    // when getting compact arrays
                    // shrink the array sizes by this factor.
                    shrink_factor: 0.2,
                    dx: [1,0,0],
                    dy: [0,1,0],
                    dz: [0,0,1],
                }, options);
                var s = this.settings;
                var context = s.feedbackContext;
                if (!context) {
                    context = $.fn.feedWebGL2({});
                }
                this.feedbackContext = context;
                var assert_positive = function(x) { 
                    if (!((x) && (x>0))) {
                        throw new Error("all dimensions must be positive: " + [s.num_rows, s.num_cols, s.num_layers]);
                    }
                };
                assert_positive(s.num_rows);
                assert_positive(s.num_cols);
                assert_positive(s.num_layers);
                this.shape = [s.num_rows, s.num_cols, s.num_layers];
                this.grid_mins = [0, 0, 0];
                this.grid_maxes = this.shape.slice();
                this.dragging_slice = null;
                this.threshold = s.threshold;

                var size = s.num_rows * s.num_cols * s.num_layers;
                var buffer = s.valuesArray;
                if (!buffer) {
                    buffer = new Float32Array(size);
                } 
                if (buffer.length != size) {
                    throw new Error("buffer size must exactly match dimensions.")
                }
                this.buffer  = buffer;
                this.slice_displays = [null, null, null];
                this.dots_display = null;
                this.surface_display = null;
                this.surface = null;
                // intial slicing indices
                this.ijk = [0,0,0];
            };
            set_up_surface() {
                debugger;
                var shape = this.shape;
                var num_cols, num_rows, num_layers;
                [num_cols, num_rows, num_layers] = shape;
                var size = num_rows * num_cols * num_layers;
                var buffer = this.buffer;
                if (buffer.length != size) {
                    throw new Error("buffer size must exactly match dimensions.")
                }
                var s = this.settings;
                var surface =  $.fn.webGL2surfaces3dopt({
                    feedbackContext: this.feedbackContext,
                    valuesArray: this.buffer,
                    num_rows: num_rows,
                    num_cols: num_cols,
                    num_layers: num_layers,
                    color: [1, 0, 0],
                    rasterize: false,
                    threshold: s.threshold,
                    shrink_factor: s.shrink_factor,  // how much to shrink the arrays
                    dx: s.dx,
                    dy: s.dy,
                    dz: s.dz,
                    translation: [0,0,0],
                });
                //surface.set_grid_limits(this.grid_mins, this.grid_maxes);
                this.surface = surface;
                this.set_limits();
                surface.run();
            };
            set_limits() {
                // xxxx someday rationalize the indexing!
                var gm = this.grid_mins;
                var mins = [gm[2], gm[1], gm[0]];
                var gM = this.grid_maxes;
                var maxes = [gM[2], gM[1], gM[0]];
                this.surface.set_grid_limits(mins, maxes);
            }
            initialize_surface_display(container) {
                if (!this.surface) {
                    this.set_up_surface();
                }
                container.empty();
                var canvas = document.createElement( 'canvas' );
                var context = canvas.getContext( 'webgl2', { alpha: false } ); 
                var renderer = new THREE.WebGLRenderer( { canvas: canvas, context: context } );
                renderer.setPixelRatio( window.devicePixelRatio );
                renderer.setSize( container.width(), container.height() );
                renderer.outputEncoding = THREE.sRGBEncoding;
                container[0].appendChild( renderer.domElement );
                var camera = new THREE.PerspectiveCamera( 45, container.width()/container.height(), 0.1, 10000 );
                var material = new THREE.MeshNormalMaterial( {  } );
                material.side = THREE.DoubleSide;
                var geometry = this.surface.linked_three_geometry(THREE);
                var mesh = new THREE.Mesh( geometry,  material );
                var scene = new THREE.Scene();
                scene.add(mesh);
                this.surface_material = material;
                this.surface_scene = scene;
                this.surface_mesh = mesh;
                this.surface_camera = camera;
                this.surface_renderer = renderer;
                this.surface.crossing.reset_three_camera(camera, 2.0);
                this.sync_cameras();
                //renderer.render( scene, camera );
            };
            sync_cameras() {
                var surface_camera = this.surface_camera;
                var voxel_camera = this.voxel_camera;
                // https://stackoverflow.com/questions/49201438/threejs-apply-properties-from-one-camera-to-another-camera
                var d = new THREE.Vector3(),
                    q = new THREE.Quaternion(),
                    s = new THREE.Vector3();
                voxel_camera.matrixWorld.decompose( d, q, s );
                surface_camera.position.copy( d );
                surface_camera.quaternion.copy( q );
                surface_camera.scale.copy( s );
            };
            initialize_voxels(container) {
                if (!this.surface) {
                    this.set_up_surface();
                }
                var voxels = this.surface.crossing;
                container.empty();
                var canvas = document.createElement( 'canvas' );
                var context = canvas.getContext( 'webgl2', { alpha: false } ); 
                var renderer = new THREE.WebGLRenderer( { canvas: canvas, context: context } );
                renderer.setPixelRatio( window.devicePixelRatio );
                renderer.setSize( container.width(), container.height() );
                renderer.outputEncoding = THREE.sRGBEncoding;
                container[0].appendChild( renderer.domElement );
                var camera = new THREE.PerspectiveCamera( 45, container.width()/container.height(), 0.1, 10000 );
                voxels.reset_three_camera(camera, 2.0);
                var mesh = voxels.get_points_mesh({
                    THREE: THREE,
                    colorize: true,
                    size: 0.5,
                });
                var scene = new THREE.Scene();
                scene.add(mesh);

                var g = new THREE.SphereGeometry(0.5, 6,6);
                var m = new THREE.MeshNormalMaterial();
                //m.wireframe = true;
                var c = new THREE.Mesh(g, m);
                c.position.set(...this.ijk);
                this.ijk_mesh = c;
                scene.add(c);

                //renderer.render( scene, camera );
                this.voxel_scene = scene;
                this.voxel_mesh = mesh;
                this.voxel_camera = camera;
                this.voxel_renderer = renderer;
                this.voxelControls = new THREE.OrbitControls(camera, renderer.domElement);
                this.voxelControls.userZoom = false;
                this.voxelClock = new THREE.Clock();
            };
            animate() {
                var delta = this.voxelClock.getDelta();
                this.voxelControls.update(delta);
                this.voxel_renderer.render(this.voxel_scene, this.voxel_camera);
                this.sync_cameras();
                this.surface_renderer.render(this.surface_scene, this.surface_camera);
                var that = this;
                requestAnimationFrame(function () { that.animate(); });
            }
            array_value(ijk) {
                // index into the values array at col_i row_j layer_k
                var nc, nr, nl;
                [nc, nr, nl] = this.shape;
                var i = ijk[0];
                var j = ijk[1];
                var k = ijk[2];
                if ((i<0) || (i>nc)) {
                    throw new Error("bad column " + ijk + " :: " + nc);
                }
                if ((j<0) || (j>nr)) {
                    throw new Error("bad row " + ijk + " :: " + nr);
                }
                if ((i<0) || (k>nl)) {
                    throw new Error("bad layer " + ijk + " :: " + nl);
                }
                var ravelled_index = i + nc * (j + nr * k);
                return this.buffer[ravelled_index];
            };
            array_slice(ijk, dimensions) {
                // 2d slice along dimensions including ijk
                var d0 = dimensions[0];  // column dimension
                var d1 = dimensions[1];  // row dimension
                var n0 = this.shape[d0];
                var n1 = this.shape[d1];
                var size = n0 * n1;
                var result = [];
                var mins = [];
                var maxes = [];
                var ijk_clone = ijk.slice();
                var vmax = this.array_value(ijk);
                var vmin = vmax;
                for (var loc1=0; loc1<n1; loc1++) {
                    var row = [];
                    for (var loc0=0; loc0<n0; loc0++) {
                        ijk_clone[d0] = loc0;
                        ijk_clone[d1] = loc1;
                        var v = this.array_value(ijk_clone);
                        vmax = Math.max(vmax, v);
                        vmin = Math.min(vmin, v);
                        row.push(v);
                    }
                    result.push(row);
                    mins.push(row.slice());
                    maxes.push(row.slice());
                }
                // pixel corner mins and maxes
                for (var loc1=0; loc1<n1; loc1++) {
                    var loc11 = loc1 + 1;
                    for (var loc0=0; loc0<n0; loc0++) {
                        var m = mins[loc1][loc0];
                        var M = maxes[loc1][loc0];
                        var loc01 = loc0 + 1;
                        if (loc11 < n1) {
                            m = Math.min(m, result[loc11][loc0]);
                            M = Math.max(M, result[loc11][loc0]);
                            if (loc01 < n0) {
                                m = Math.min(m, result[loc11][loc01]);
                                M = Math.max(M, result[loc11][loc01]);
                            }
                        }
                        if (loc01 < n0) {
                            m = Math.min(m, result[loc1][loc01]);
                            M = Math.max(M, result[loc1][loc01]);
                        }
                        mins[loc1][loc0] = m;
                        maxes[loc1][loc0] = M;
                    }
                }
                // ravelled bytes with rows reversed
                var diff = Math.max(1e-10, vmax - vmin);
                var bytes = new Uint8Array(size);
                for (var rownum=0; rownum<n1; rownum++) {
                    var ravelled_offset = n0 * (n1 - rownum - 1);
                    var row = result[rownum];
                    for (var colnum=0; colnum<n0; colnum++) {
                        var ravelled_index = colnum + ravelled_offset;
                        var unscaled = row[colnum];
                        var scaled = Math.floor(255 * (unscaled - vmin) / diff);
                        bytes[ravelled_index] = scaled;
                    }
                }
                return {
                    array: result,
                    mins: mins,
                    maxes: maxes,
                    rows: n1,
                    cols: n0,
                    vmax: vmax,
                    vmin: vmin,
                    bytes: bytes,
                }
            }
            build_scaffolding(container, width) {
                // create standard layout for 3 slices, voxel dots and contours
                var that = this;
                var contour_side = width * 0.5;
                var slice_side = contour_side * 0.5;
                container.empty();
                container.css({
                    "display": "grid",
                    "grid-template-columns": `${slice_side}px ${slice_side}px ${contour_side}px`,
                    "grid-template-rows": `${slice_side}px ${slice_side}px auto`,
                    "grid-gap": "3px",
                });
                var x_div = $("<div/>").appendTo(container);
                x_div.html("X DIV HERE");
                x_div.css({
                    "background-color": "#fee",
                    "grid-column": "2",
                    "grid-row": "1",
                    "height": `${slice_side}px`,
                });
                // X slicer shows Z in columns and Y in rows
                this.x_slicer = new Slicer32(this, [0,1], x_div, slice_side);

                var y_div = $("<div/>").appendTo(container);
                y_div.html("Y DIV HERE");
                y_div.css({
                    "background-color": "#efe",
                    "grid-column": "1",
                    "grid-row": "2",
                    "height": `${slice_side}px`,
                });
                // Y slicer shows X in columns and Z in rows
                this.y_slicer = new Slicer32(this, [2,0], y_div, slice_side);

                var z_div = $("<div/>").appendTo(container);
                z_div.html("Z DIV HERE");
                z_div.css({
                    "background-color": "#eef",
                    "grid-column": "1",
                    "grid-row": "1",
                    "height": `${slice_side}px`,
                });
                // Z slicer shows X in columns and Y in rows
                this.z_slicer = new Slicer32(this, [2,1], z_div, slice_side);

                var dots_div = $("<div/>").appendTo(container);
                dots_div.html("DOTS DIV HERE");
                dots_div.css({
                    "background-color": "#fef",
                    "grid-column": "2",
                    "grid-row": "2",
                    "height": `${slice_side}px`,
                });
                this.initialize_voxels(dots_div);

                var contour_div = $("<div/>").appendTo(container);
                contour_div.html("CONTOUR DIV HERE");
                contour_div.css({
                    "background-color": "#eff",
                    "grid-column": "3",
                    "grid-row": "1 / 3",
                    "height": `${contour_side}px`,
                });
                this.initialize_surface_display(contour_div);

                this.slice_displays = [this.x_slicer, this.y_slicer, this.z_slicer];

                // info area
                this.info = $("<div/>").appendTo(container);

                // button area
                var button_area = $("<div/>").appendTo(container);
                this.focus_button = $("<button>Focus</button>").appendTo(button_area);
                this.focus_button.click(function() { that.focus_volume(); });

                this.sync_button = $("<button>sync</button>").appendTo(button_area);
                this.sync_button.click(function() { that.redraw(true); });

                var auto_sync = $("<span> auto</span>").appendTo(button_area)
                this.sync_check = $('<input type="checkbox" checked/>').appendTo(auto_sync);
                this.sync_check.change(function() {
                    that.redraw();
                });

                var wires = $("<span> wires</span>").appendTo(button_area)
                this.wires_check = $('<input type="checkbox"/>').appendTo(wires);
                this.wires_check.change(function() {
                    that.redraw();
                });

                // threshold slider
                var slider =  $("<div/>").appendTo(container);
                slider.css("background-image", "linear-gradient(to right, blue, yellow)");
                var bmin = this.buffer[0];
                var bmax = this.buffer[0];
                for (var i=0; i<this.buffer.length; i++) {
                    bmin = Math.min(this.buffer[i], bmin);
                    bmax = Math.max(this.buffer[i], bmax);
                }
                this.bmin = bmin;
                this.bmax = bmax;
                var update = function () {
                    var threshold = + slider.slider("option", "value");
                    that.info.html("SLIDE TO: " + threshold);
                    that.threshold = threshold;
                    //that.update_volume();
                    that.redraw();
                };
                slider.slider({
                    min: bmin,
                    max: bmax,
                    step: 0.01 * (bmax - bmin),
                    value: this.threshold,
                    slide: update,
                    change: update,
                })
                this.threshold_slider = slider;

                this.show_info();
                this.animate()
            };
            set_threshold(value) {
                value = value || this.bmin
                value = Math.min(this.bmax, Math.max(this.bmin, value));
                this.threshold = value;
                this.threshold_slider.slider("option", "value", value);
            };
            focus_volume() {
                var surface = this.surface;
                var crossing = this.surface.crossing;
                var shift = 2.0;
                crossing.reset_three_camera(this.surface_camera, shift);
                crossing.reset_three_camera(this.voxel_camera, shift, this.voxelControls);
            };
            show_info() {
                this.info.html("ijk: " + this.ijk + ", threshold: " + this.threshold.toExponential(2))
            };
            update_volume() {
                var surface = this.surface;
                this.set_limits();
                surface.set_threshold(this.threshold);
                surface.run();
                this.voxel_mesh.update_sphere_locations(surface.crossing.compact_locations);
                var wires = this.wires_check.is(":checked");
                this.surface_material.wireframe = wires;
                surface.check_update_link();
            };
            redraw(sync) {
                if (!sync) {
                    sync = this.sync_check.is(':checked');
                }
                this.slice_displays.map(x => x.draw_frame());
                this.ijk_mesh.position.set(...this.ijk);
                if (sync) {
                    this.update_volume();
                }
                this.show_info();
            };
        };

        class Slicer32 {
            constructor(volume, dimensions, container, side) {
                this.volume = volume;
                this.container = container;
                // indices for row and column in this slice (not the sliced dimension)
                this.dimensions = dimensions;
                this.side = side;
                var d0, d1;
                [d0, d1] = dimensions;
                var names = ["Z", "Y", "X"];
                this.name = "slice(" + d0 + "," + d1 + ")";
                this.hname = names[d0];
                this.vname = names[d1];
                var vshape = volume.shape;
                this.shape = [vshape[d0], vshape[d1]];
                var maxdim = Math.max(...this.shape);
                this.container = container;
                this.side = side;
                var config = {
                    width: side,
                    height: side,
                }
                container.empty();
                container.dual_canvas_helper(config);
                this.frame = container.frame_region(
                    0, 0, side, side,
                    0, 0, maxdim, maxdim
                );
                this.frame_factor = side * 1.0 / maxdim;
                this.maxdim = maxdim;
                this.dragging = null;
                this.draw_frame();
            }
            draw_frame() {
                var d0, d1, i0, i1;
                var volume = this.volume;
                var frame = this.frame;
                [i0, i1] = this.dimensions;
                [d0, d1] = this.shape;
                var grid_mins = [volume.grid_mins[i0], volume.grid_mins[i1]];
                var grid_maxes = [volume.grid_maxes[i0], volume.grid_maxes[i1]];
                var m = this.maxdim;
                var blue = [0,0,255,255]
                var yellow = [255,255,0,255]
                frame.reset_frame();
                var event_rect = frame.frame_rect({x:-1, y:-1, w:d0+1, h:d1+1, color:"rgba(0,0,0,0)", name:"event_rect"})
                var slice_info = this.volume.array_slice(this.volume.ijk, this.dimensions);
                this.container.name_image_data(self.name, slice_info.bytes, slice_info.cols, slice_info.rows, blue, yellow);
                var ff = this.frame_factor;
                frame.named_image({image_name: self.name, x:0, y:0, w:ff*slice_info.cols, h:ff*slice_info.rows})
                frame.lower_left_axes({
                    min_x:0, min_y:0, max_x:this.shape[0], max_y:this.shape[1],
                    x_anchor: 0, y_anchor:0, max_tick_count:3,
                });
                frame.text({x:-0.1*m, y:d1 * 0.5, align:"right", text: this.vname})
                frame.text({y:-0.1*m, x:d0 * 0.5, text: this.hname, degrees:-90})
                // circles marking crossing pixels
                var threshold = this.volume.threshold;
                var mins = slice_info.mins;
                var maxes = slice_info.maxes;
                for (var i=0; i<d0; i++) {
                    for (var j=0; j<d1; j++) {
                        var m = mins[j][i];
                        var M = maxes[j][i];
                        if ((m <= threshold) && (M >= threshold)) {
                            frame.frame_circle({x: i + 0.5, y: j + 0.5, fill:false, color:"white", r:0.35});
                        }
                    }
                }
                // highlight ijk point
                var hx = this.volume.ijk[i0];
                var hy = this.volume.ijk[i1];
                frame.frame_circle({x: hx+0.5, y:hy+0.5, r:0.25, color:"rgba(255,255,255,0.7)"});
                frame.frame_circle({x: hx+0.5, y:hy+0.5, r:0.25, color:"black", fill:false});

                // min boundaries
                frame.frame_rect({x: grid_mins[0], y:0, w:-grid_mins[0], h:d1, color:"rgba(255,255,255,0.5)"});
                frame.frame_rect({x: 0, y:grid_mins[1], w:d0, h:-grid_mins[1], color:"rgba(255,255,255,0.5)"});
                // max boundaries
                frame.frame_rect({x: grid_maxes[0], y:0, w:d0-grid_maxes[0], h:d1, color:"rgba(255,255,255,0.5)"});
                frame.frame_rect({x: 0, y:grid_maxes[1], w:d0, h:d1-grid_maxes[1], color:"rgba(255,255,255,0.5)"});
                // boundary draggers
                var Mins = frame.rect({x: grid_mins[0], y: grid_mins[1], w:-20, h:-20, color:"black", name:"Mins"})
                var Maxes = frame.rect({x: grid_maxes[0], y: grid_maxes[1], w:20, h:20, color:"black", name:"Maxes"})

                this.container.fit(null, 10);

                // events
                var that = this;

                var click = function(event) {
                    //cl("click: " + event.canvas_name);
                    if (volume.dragging_slice == that) {
                        //cl("click: let mouse up handler deal with it...");
                        return;
                    }
                    //cl("click: resetting ijk");
                    volume.dragging_slice = null;
                    // if the event is in bounds, set the ijk and the threshold and redraw
                    var frame_location = that.frame.event_model_location(event);
                    var x = Math.floor(frame_location.x);
                    var y = Math.floor(frame_location.y);
                    if ((x >= 0) && (x < d0) && (y >= 0) && (y < d1)) {
                        debugger;
                        that.volume.ijk[i0] = x;
                        that.volume.ijk[i1] = y;
                        //that.volume.threshold = 0.5 * (mins[y][x] + maxes[y][x]);
                        var threshold = 0.5 * (mins[y][x] + maxes[y][x]);
                        that.volume.set_threshold(threshold)
                        that.volume.redraw();
                    }
                };
                event_rect.on("click", click);

                //this.dragging = null;
                var mouse_down = function(event) {
                    var name = event.canvas_name;
                    if ((name=="Mins") || (name=="Maxes")) {
                        //cl("mouse_down dragging: " + name);
                        that.dragging = name;
                        volume.dragging_slice = that;
                    } else {
                        //cl("mouse_down: no valid target to drag.");
                        that.dragging = null;
                        volume.dragging_slice = null;
                    }
                };
                Mins.on("mousedown", mouse_down);
                Maxes.on("mousedown", mouse_down);

                var mouse_move = function(event) {
                    if (volume.dragging_slice == that) {
                        var frame_location = that.frame.event_model_location(event);
                        var x = Math.round(frame_location.x);
                        var y = Math.round(frame_location.y);
                        if ((x >= -1) && (x <= d0) && (y >= -1) && (y <= d1)) {
                            if (that.dragging == "Mins") {
                                //cl("mouse_move mins: " + [x,y]);
                                volume.grid_mins[i0] = x;
                                volume.grid_mins[i1] = y;
                                volume.redraw();
                            } else if (that.dragging == "Maxes") {
                                //cl("mouse_move maxes: " + [x,y]);
                                volume.grid_maxes[i0] = x;
                                volume.grid_maxes[i1] = y;
                                volume.redraw();
                            } else {
                                //cl("mouse_move not dragging valid name: ", that.dragging);
                                that.dragging = null;
                                volume.dragging_slice = null;
                            }
                        }
                    } else {
                        //cl("mouse_move not dragging slice");
                        that.dragging = null;
                        volume.draggin_slice = null;
                    }
                };
                event_rect.on("mousemove", mouse_move);

                var mouse_up = function(event) {
                    //cl("mouse_up")
                    volume.dragging_slice = null;
                };
                this.container.on_canvas_event("mouseup", mouse_up);
                //this.container.on_canvas_event("mouseout", mouse_up);
                // attach to mouseout jQuery event (not canvas event)
                //this.container.on("mouseout", mouse_up);
            };
        };

        return new Volume32(options);
    };

    $.fn.volume32.example = function (container) {
        var valuesArray, num_rows, num_cols, num_layers, threshold;
        if (false) {
            num_rows = 3;
            num_cols = 3;
            num_layers = 3;
            threshold = 0.5;
            valuesArray = new Float32Array([
                1,0,0,  // should show at lower left corner when visible
                1,0,0,
                0,0,0,

                0,0,0,
                0,1,0,
                0,0,0,

                0,1,0,
                0,0,0,
                0,0,0,
            ]);
        } else {
            num_rows = 18;
            num_cols = 16;
            num_layers = 17;
            threshold = 7.333;
            valuesArray = new Float32Array(num_rows * num_cols * num_layers);
            var index = 0;
            for (var k=0; k<num_layers; k++) {
                var dk = k - 2;
                for (var j=0; j<num_cols; j++) {
                    var dj = j - 4;
                    for (var i=0; i<num_rows; i++) {
                        var di = i - 3;
                        valuesArray[index] = Math.sqrt(dk * dk + dj * dj + di * di);
                        index ++;
                    }
                }
            }
        }
        debugger;
        var V = container.volume32({
            valuesArray: valuesArray,
            num_rows: num_rows,
            num_cols: num_cols,
            num_layers: num_layers,
            threshold: threshold,
            shrink_factor: 0.45,
        });
        V.build_scaffolding(container, 1200);
        return V
    };

})(jQuery)