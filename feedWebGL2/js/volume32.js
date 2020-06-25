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
                this.shape = [s.num_cols, s.num_rows, s.num_layers];
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
                var shape = this.shape;
                var num_cols, num_rows, num_layers;
                [num_cols, num_rows, num_layers] = shape;
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
                    dx: [1,0,0],
                    dy: [0,1,0],
                    dz: [0,0,1],
                    translation: [0,0,0],
                });
                surface.set_grid_limits([0,0,0], shape);
                surface.run();
                this.surface = surface;
            };
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
                this.surface_scene = scene;
                this.surface_mesh = mesh;
                this.surface_camera = camera;
                this.surface_renderer = renderer;
                this.surface.crossing.reset_three_camera(camera);
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
                voxels.reset_three_camera(camera, 3.5);
                var mesh = voxels.get_points_mesh({
                    THREE: THREE,
                    colorize: true,
                    size: 0.5,
                });
                var scene = new THREE.Scene();
                scene.add(mesh);

                //var g = new THREE.SphereGeometry(1, 6,6);
                //var m = new THREE.MeshNormalMaterial();
                //m.wireframe = true;
                //var c = new THREE.Mesh(g, m);
                //scene.add(c);

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
                var contour_side = width * 0.5;
                var slice_side = contour_side * 0.5;
                container.empty();
                container.css({
                    "display": "grid",
                    "grid-template-columns": `${slice_side}px ${slice_side}px ${contour_side}px`,
                    "grid-template-rows": `${slice_side}px ${slice_side}px}`,
                    //"grid-gap": `${s.gap}`,
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
                this.x_slicer = new Slicer32(this, [2,1], x_div, slice_side);

                var y_div = $("<div/>").appendTo(container);
                y_div.html("Y DIV HERE");
                y_div.css({
                    "background-color": "#efe",
                    "grid-column": "1",
                    "grid-row": "2",
                    "height": `${slice_side}px`,
                });
                // Y slicer shows X in columns and Z in rows
                this.y_slicer = new Slicer32(this, [0,2], y_div, slice_side);

                var z_div = $("<div/>").appendTo(container);
                z_div.html("Z DIV HERE");
                z_div.css({
                    "background-color": "#eef",
                    "grid-column": "1",
                    "grid-row": "1",
                    "height": `${slice_side}px`,
                });
                // Z slicer shows X in columns and Y in rows
                this.z_slicer = new Slicer32(this, [0,1], z_div, slice_side);

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
                this.info = $("<div/>").appendTo(container);
                this.show_info();
                this.animate()
            };
            show_info() {
                this.info.html("ijk: " + this.ijk + ", threshold: " + this.threshold.toExponential(2))
            };
            redraw() {
                this.slice_displays.map(x => x.draw_frame());
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
                var names = ["X", "Y", "Z"];
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
                this.draw_frame();
            }
            draw_frame() {
                var d0, d1, i0, i1;
                [i0, i1] = this.dimensions;
                [d0, d1] = this.shape;
                var m = this.maxdim;
                var blue = [0,0,255,255]
                var yellow = [255,255,0,255]
                this.frame.reset_frame();
                var event_rect = this.frame.frame_rect({x:0, y:0, w:d0, h:d1, color:"black", name:"event_rect"})
                var slice_info = this.volume.array_slice(this.volume.ijk, this.dimensions);
                this.container.name_image_data(self.name, slice_info.bytes, slice_info.cols, slice_info.rows, blue, yellow);
                var ff = this.frame_factor;
                this.frame.named_image({image_name: self.name, x:0, y:0, w:ff*slice_info.cols, h:ff*slice_info.rows})
                this.frame.lower_left_axes({
                    min_x:0, min_y:0, max_x:this.shape[0], max_y:this.shape[1],
                    x_anchor: 0, y_anchor:0, max_tick_count:3,
                });
                this.frame.text({x:-0.1*m, y:d1 * 0.5, align:"right", text: this.vname})
                this.frame.text({y:-0.1*m, x:d0 * 0.5, text: this.hname, degrees:-90})
                // circles marking crossing pixels
                var threshold = this.volume.threshold;
                var mins = slice_info.mins;
                var maxes = slice_info.maxes;
                for (var i=0; i<d0; i++) {
                    for (var j=0; j<d1; j++) {
                        var m = mins[j][i];
                        var M = maxes[j][i];
                        if ((m <= threshold) && (M >= threshold)) {
                            this.frame.frame_circle({x: i + 0.5, y: j + 0.5, fill:false, color:"white", r:0.35});
                        }
                    }
                }
                // highlight ijk point
                var hx = this.volume.ijk[i0];
                var hy = this.volume.ijk[i1];
                this.frame.frame_circle({x: hx+0.5, y:hy+0.5, r:0.25, color:"rgba(255,255,255,0.7)"});
                this.frame.frame_circle({x: hx+0.5, y:hy+0.5, r:0.25, color:"black", fill:false});
                this.container.fit(null, 10);

                // events
                var that = this;

                var click = function(event) {
                    // if the event is in bounds, set the ijk and the threshold and redraw
                    var frame_location = that.frame.event_model_location(event);
                    var x = Math.floor(frame_location.x);
                    var y = Math.floor(frame_location.y);
                    if ((x >= 0) && (x < d0) && (y >= 0) && (y < d1)) {
                        that.volume.ijk[i0] = x;
                        that.volume.ijk[i1] = y;
                        that.volume.threshold = 0.5 * (mins[y][x] + maxes[y][x]);
                        that.volume.redraw();
                    }
                };
                event_rect.on("click", click);
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
                for (var j=0; j<num_rows; j++) {
                    var dj = j - 4;
                    for (var i=0; i<num_cols; i++) {
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