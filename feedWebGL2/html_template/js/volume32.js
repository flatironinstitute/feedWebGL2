/*
// jQuery plugin encapsulating a 3d volume viewer
//
// Uses jp_doodle, three.js, feedWebGL2, feedbackSurface.js

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/
*/

(function($) {

    class Volume32 {
        constructor(options) {
            this.settings = $.extend({
                feedbackContext: null,    // the underlying FeedbackContext context to use
                valuesArray: null,   // the array buffer of values to contour
                // stream lines settings if relevant
                stream_lines_parameters: null,
                num_rows: null,
                num_cols: null,
                num_layers: 1,  // default to "flat"
                threshold: 0,  // value at contour
                // when getting compact arrays
                // shrink the array sizes by this factor.
                //shrink_factor: 0.2,
                di: [1,0,0],
                dj: [0,1,0],
                dk: [0,0,1],
                // isosurface generation method "diagonal" or "tetrahedra"
                method: "tetrahedra",
                sorted: false,
                SurfaceClearColorHex: 0xffffff,
                VoxelClearColorHex: 0xffffff,
                camera_up: {x:0, y:1, z:0},
                camera_offset: {x:0, y:0, z:1},
                camera_distance_multiple: 2.0,
                axis_length: true,  // auto assign length
                ijk_highlight_corners: null,
                //shrink_factor: null,   // how much to strink internal buffers in [0..1] LEAVE UNSET
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

            if (s.axis_length === true) {
                // auto assign axis length to average dimension
                s.axis_length = (
                    s.num_rows * this.vnorm(s.di) + 
                    s.num_cols * this.vnorm(s.dj) + 
                    s.num_layers * this.vnorm(s.dk)) / 3.0
            }
            //this.shape = [s.num_rows, s.num_cols, s.num_layers];
            this.shape = [s.num_cols, s.num_rows, s.num_layers];
            this.grid_mins = [0, 0, 0];
            this.grid_maxes = this.shape.slice();
            //this.dragging_slice = null;
            this.threshold = s.threshold;

            var size = s.num_rows * s.num_cols * s.num_layers;
            var buffer = s.valuesArray;
            if (!buffer) {
                // assume the this.buffer will be set to an appropriate value before set_up_surface
                // buffer = new Float32Array(size);
            } else if (buffer.length != size) {
                throw new Error("buffer size must exactly match dimensions.")
            }
            var stream_lines_sequence = null;
            if ((s.stream_lines_parameters) && (s.stream_lines_parameters.stream_lines)) {
                stream_lines_sequence = s.stream_lines_parameters.stream_lines;
            }  // otherwise assume it will be set before set_up_streamlines
            this.stream_lines_sequence = stream_lines_sequence;
            this.buffer  = buffer;
            this.slice_displays = [null, null, null];
            this.dots_display = null;
            this.surface_display = null;
            this.surface = null;
            this.stream_lines = null;
            // intial slicing indices
            //this.kji = [0,0,0];
            this.kji = [Math.floor(s.num_cols/2), Math.floor(s.num_rows/2), Math.floor(s.num_layers/2), ];
            // for debugging
            this.dump_events = false;

            // custom init for subclassing
            this.custom_initialization();
        };
        custom_initialization() {
            this.supports_cutting = true;
        };
        set_slice_ijk(i, j, k, change_threshold) {
            var kji = [k, j, i];
            // array value validates values
            var value = this.array_value(kji);
            this.kji = kji;
            if (change_threshold) {
                // redraw in implicit
                this.set_threshold(value);
            } else {
                this.redraw();
            }
        }
        // xxxx really should get these from somewhere else
        vsum(v1, v2) {
            var result = [];
            for (var k=0; k<3; k++) {
                result.push(v1[k] + v2[k]);
            }
            return result;
        };
        vscale(scalar, v) {
            var result = [];
            for (var k=0; k<3; k++) {
                result.push(scalar * v[k]);
            }
            return result;
        };
        vdistance2(v1, v2) {
            var result = 0.0;
            if ((v1) && (v2)) {
                for (var k=0; k<3; k++) {
                    var d = v1[k] - v2[k];
                    result += d * d;
                }
            }
            return result;
        };
        vdistance(v1, v2) {
            return Math.sqrt(this.vdistance2(v1, v2));
        };
        vnorm(v) {
            return this.vdistance(v, [0, 0, 0]);
        }
        set_up_surface() {
            var shape = this.shape;
            var num_cols, num_rows, num_layers;
            [num_cols, num_rows, num_layers] = shape;
            var size = num_rows * num_cols * num_layers;
            var buffer = this.buffer;
            if (buffer.length != size) {
                throw new Error("buffer size must exactly match dimensions.")
            }
            var s = this.settings;
            var surface =  this.get_surface({
                feedbackContext: this.feedbackContext,
                valuesArray: this.buffer,
                num_rows: num_rows,
                num_cols: num_cols,
                num_layers: num_layers,
                color: [1, 0, 0],
                rasterize: false,
                threshold: s.threshold,
                shrink_factor: s.shrink_factor,  // how much to shrink the arrays
                dk: s.dk,
                dj: s.dj,
                di: s.di,
                translation: [0,0,0],
                sorted: s.sorted,
            });
            //surface.set_grid_limits(this.grid_mins, this.grid_maxes);
            this.surface = surface;
            this.set_limits();
            surface.run();
        };
        get_surface(options) { 
            var s = this.settings;
            var init = $.fn.webGL2surfaces3dopt;
            if (s.method == "diagonal") {
                init = $.fn.webGL2surfaces_from_diagonals;
            }
            return init(options);
        };
        set_up_streamlines() {
            var s = this.settings;
            var parameters = $.extend({
                feedbackContext: this.feedbackContext,
                cycle_duration: 1.0,
            }, s.stream_lines_parameters);
            parameters.stream_lines =  parameters.stream_lines || this.stream_lines_sequence;
            parameters.dk = parameters.dk || s.dk;
            parameters.di = parameters.di || s.di;
            parameters.dj = parameters.dj || s.dj;
            if (!parameters.stream_lines) {
                throw new Error("sequence of stream line polylines is required.")
            }
            this.stream_lines = $.fn.streamLiner(parameters);
            // run the stream lines so buffers are available
            this.stream_lines.run(0.0);
            return this.stream_lines;
        };
        set_limits() {
            // xxxx someday rationalize the indexing!
            var gm = this.grid_mins;
            var mins = [gm[2], gm[1], gm[0]];
            var gM = this.grid_maxes;
            var maxes = [gM[2], gM[1], gM[0]];
            this.surface.set_grid_limits(mins, maxes);
        }
        update_slice_info() {
            var gm = this.grid_mins;
            var gM = this.grid_maxes;
            this.slice_info.html( 
                "[" +
                gm[2] + ":" + gM[2] + ", " +
                gm[1] + ":" + gM[1] + ", " +
                gm[0] + ":" + gM[0] +
                "]"
            )
        };
        get_array_slicing() {
            var gm = this.grid_mins;
            var gM = this.grid_maxes;
            return [
                [gm[2], gM[2]],
                [gm[1], gM[1]],
                [gm[0], gM[0]],
            ];
        };
        get_positions(buffer) {
            // get positions for iso-surface triangles and streamline triangles
            // xxxx could optimize to not copy/draw degenerate triangles
            var clean = true;
            this.surface_positions = this.surface.get_positions(this.surface_positions, clean);
            this.stream_positions = this.stream_lines.vertex_positions(this.stream_positions);
            var length = this.surface_positions.length + this.stream_positions.length;
            if (buffer) {
                if (buffer.length != length) {
                    throw new Error("preallocated buffer must have correct length.")
                }
            } else {
                buffer = new Float32Array(length);
            }
            //buffer.set(this.stream_positions);
            buffer.set(this.surface_positions);
            buffer.set(this.stream_positions, this.surface_positions.length);
            return buffer;
        };
        get_normals(buffer) {
            // get positions for iso-surface triangles and streamline triangles
            this.surface_normals = this.surface.get_normals(this.surface_normals);
            this.stream_normals = this.stream_lines.vertex_normals(this.stream_normals);
            var length = this.surface_normals.length + this.stream_normals.length;
            if (buffer) {
                if (buffer.length != length) {
                    throw new Error("preallocated buffer must have correct length.")
                }
            } else {
                buffer = new Float32Array(length);
            }
            //buffer.set(this.stream_normals);
            buffer.set(this.surface_normals);
            buffer.set(this.stream_normals, this.surface_normals.length);
            return buffer;
        };
        get_surface_geometry() {
            var s = this.settings;
            var geometry;
            if (s.stream_lines_parameters) {
                geometry = new THREE.BufferGeometry();
                // create a geometry including streams and surface triangles
                if (!this.stream_lines) {
                    this.stream_lines = this.set_up_streamlines();
                }
                this.positions = this.get_positions();
                this.normals = this.get_normals();
                geometry.setAttribute( 'position', new THREE.BufferAttribute( this.positions, 3 ) );
                geometry.setAttribute( 'normal', new THREE.BufferAttribute( this.normals, 3 ) );
            } else {
                // just use auto-updating surface geometry.
                geometry = this.surface.linked_three_geometry(THREE);
            }
            this.surface_geometry = geometry;
            return geometry;
        };
        update_surface_geometry(for_time) {
            var s = this.settings;
            var geometry = this.surface_geometry;
            if (s.stream_lines_parameters) {
                // update the streamline animation and reset the geometry buffers
                var cycle_duration = s.stream_lines_parameters.cycle_duration;
                var interpolate = (for_time % cycle_duration)/cycle_duration;
                this.stream_lines.run(interpolate);
                // xxxx could optimize to not draw degenerate triangles...
                var positions = this.get_positions();
                var normals = this.get_normals();
                //var positions = this.get_positions(geometry.attributes.position.array);
                //var normals = this.get_normals(geometry.attributes.normal.array);
                geometry.attributes.position.array = positions;
                geometry.attributes.position.needsUpdate = true;
                geometry.attributes.normal.array = normals;
                geometry.attributes.normal.needsUpdate = true;
            } else {
                // do nothing. The linked surface geometry updates on demand.
            }
            return geometry;
        };
        initialize_surface_display(container) {
            if (!this.surface) {
                this.set_up_surface();
            }
            var s = this.settings;
            container.empty();
            var canvas = document.createElement( 'canvas' );
            //var context = canvas.getContext( 'webgl2', { alpha: false } ); 
            var context = get_webgl_context(canvas);
            var renderer = new THREE.WebGLRenderer( { canvas: canvas, context: context } );
            renderer.setPixelRatio( window.devicePixelRatio );
            renderer.setClearColor(s.SurfaceClearColorHex, 1);
            renderer.setSize( container.width(), container.height() );
            renderer.outputEncoding = THREE.sRGBEncoding;
            container[0].appendChild( renderer.domElement );
            var camera = new THREE.PerspectiveCamera( 45, container.width()/container.height(), 0.1, 10000 );
            var material = new THREE.MeshNormalMaterial( {  } );
            material.side = THREE.DoubleSide;
            var geometry = this.get_surface_geometry();
            var mesh = new THREE.Mesh( geometry,  material );
            var scene = new THREE.Scene();
            scene.add(mesh);
            if (s.axis_length) {
                // add axes indicator
                var ln = s.axis_length;
                var ln1 = ln * 1.1;
                var ln2 = ln * 0.1;
                var axesHelper = new THREE.AxesHelper( ln );
                scene.add(axesHelper);
                THREE.sprite_text(scene, "X", [[ln1, 0, 0]], ln2, "red", 20);
                THREE.sprite_text(scene, "Y", [[0, ln1, 0]], ln2, "green", 20);
                THREE.sprite_text(scene, "Z", [[0, 0, ln1]], ln2, "blue", 20);
            }
            this.surface_context = context;
            this.surface_material = material;
            this.surface_scene = scene;
            this.surface_mesh = mesh;
            this.surface_camera = camera;
            this.surface_renderer = renderer;
            //this.surface.crossing.reset_three_camera(camera, 2.0);
            this.reset_camera(camera);
            this.sync_cameras();
            //renderer.render( scene, camera );
        };
        get_voxel_pixels() {
            return this.get_pixels(self.voxel_context);
        };
        get_pixels(context) {
            context = context || this.surface_context;
            var width = context.drawingBufferWidth;
            var height = context.drawingBufferHeight;
            var buffer = new Uint8Array(4 * height * width);
            var format = context.RGBA;
            var typ = context.UNSIGNED_BYTE;
            context.readPixels(0, 0, width, height, format, typ, buffer)
            return {"data": buffer, "height": height, "width": width};
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
        camera_owner() {
            return this.surface.crossing;
        };
        reset_camera(
            //owner,
            camera, radius_multiple, orbit_control, radius, cx, cy, cz, up, offset
        ) {
            var s = this.settings;
            var owner = this.camera_owner();
            radius_multiple = radius_multiple || s.camera_distance_multiple;
            up = up || s.camera_up;
            offset = offset || s.camera_offset;
            owner.reset_three_camera(
                camera, radius_multiple, orbit_control, radius, cx, cy, cz, up, offset
            );
        };

        get_points_mesh() {
            var voxels = this.surface.crossing;
            return voxels.get_points_mesh({
                THREE: THREE,
                colorize: true,
                size: this.point_size(),
            });
        };

        initialize_voxels(container) {
            var s = this.settings;
            if (!this.surface) {
                this.set_up_surface();
            }
            //var voxels = this.surface.crossing;
            container.empty();
            var canvas = document.createElement( 'canvas' );
            //var context = canvas.getContext( 'webgl2', { alpha: false } ); 
            var context = get_webgl_context(canvas);
            var renderer = new THREE.WebGLRenderer( { canvas: canvas, context: context } );
            renderer.setClearColor(s.VoxelClearColorHex, 1);
            renderer.setPixelRatio( window.devicePixelRatio );
            renderer.setSize( container.width(), container.height() );
            renderer.outputEncoding = THREE.sRGBEncoding;
            container[0].appendChild( renderer.domElement );
            var camera = new THREE.PerspectiveCamera( 45, container.width()/container.height(), 0.1, 10000 );
            this.reset_camera(camera, null);
            // then create the orbiter
            this.voxelControls = new THREE.OrbitControls(camera, renderer.domElement);
            // then reset the orbit center (and camera parameters again)
            this.reset_camera(camera, null, this.voxelControls);
            var mesh = this.get_points_mesh();
            var scene = new THREE.Scene();
            scene.add(mesh);

            var g = new THREE.SphereGeometry(0.5, 6,6);
            var m = new THREE.MeshNormalMaterial();
            m.wireframe = true;
            var c = new THREE.Mesh(g, m);
            c.position.set(...this.kji);
            this.kji_mesh = c;
            scene.add(c);

            //renderer.render( scene, camera );
            this.voxel_context = context;
            this.voxel_scene = scene;
            this.voxel_mesh = mesh;
            this.voxel_camera = camera;
            this.voxel_renderer = renderer;
            //this.voxelControls = new THREE.OrbitControls(camera, renderer.domElement);
            //this.voxelControls.userZoom = false;
            this.voxelControls.update();
            this.voxelClock = new THREE.Clock();
        };
        get_voxel_pixels() {
            return this.get_pixels(this.voxel_context);
        };
        add_mesh(vertices, normals, color, wireframe) {
            // add a basic mesh to the surface_scene
            // xxxx should add support for other kinds of material eventually.
            var scene = this.surface_scene;
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute( 'position', new THREE.BufferAttribute( vertices, 3 ) );
            geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
            var material = new THREE.MeshBasicMaterial( { color: color } );
            material.wireframe = wireframe;
            var mesh = new THREE.Mesh( geometry,  material );
            scene.add(mesh);
        };
        dispose() {
            // call this when the object is no longer in use.  It tries to free up memory.
            try {
                this.feedbackContext.lose_context();
            } catch (e) {};
            try {
                this.voxel_renderer.renderLists.dispose();
            } catch (e) {};
            try {
                this.surface_renderer.renderLists.dispose();
            } catch (e) {};
            for (var name in this) {
                this[name] = null;
            }
        };
        // ??? eventually render on demand:
        // https://threejsfundamentals.org/threejs/lessons/threejs-rendering-on-demand.html
        animate() {
            var render_ok = this.render();
            if (render_ok) {
                var that = this;
                requestAnimationFrame(function () { that.animate(); });
            }
        };
        request_render() {
            var requested = this.awaiting_render;
            if (!requested) {
                this.surface_renderer.render(this.surface_scene, this.surface_camera);
                var that = this;
                requestAnimationFrame(function () { that.render(); });
                this.awaiting_render = true;
            }
        };
        render() {
            this.awaiting_render = false;
            var container = this.container;
            if ((!container) || (!container[0].isConnected)) {
                console.log("Terminating volume animation because container is disconnected.");
                this.dispose();
                this.container = null;
                return false;
            }
            var delta = this.voxelClock.getDelta();
            this.update_surface_geometry(this.voxelClock.elapsedTime);
            //this.voxelControls.update();
            this.voxel_renderer.render(this.voxel_scene, this.voxel_camera);
            this.sync_cameras();
            this.surface_renderer.render(this.surface_scene, this.surface_camera);
            // automatically request another render if streamlines are active
            if (this.stream_lines) {
                this.request_render();
            }
            return true;
        };
        array_value(kji) {
            // index into the values array at col_i row_j layer_k
            var nc, nr, nl;
            [nc, nr, nl] = this.shape;
            var k = kji[0];
            var j = kji[1];
            var i = kji[2];
            if ((k<0) || (k>nc)) {
                throw new Error("bad column " + kji + " :: " + nc);
            }
            if ((j<0) || (j>nr)) {
                throw new Error("bad row " + kji + " :: " + nr);
            }
            if ((i<0) || (i>nl)) {
                throw new Error("bad layer " + kji + " :: " + nl);
            }
            var ravelled_index = k + nc * (j + nr * i);
            return this.buffer[ravelled_index];
        };
        array_slice(kji, dimensions) {
            // 2d slice along dimensions including kji
            var d0 = dimensions[0];  // column dimension
            var d1 = dimensions[1];  // row dimension
            var n0 = this.shape[d0];
            var n1 = this.shape[d1];
            var size = n0 * n1;
            var result = [];
            var mins = [];
            var maxes = [];
            var kji_clone = kji.slice();
            var vmax = this.array_value(kji);
            var vmin = vmax;
            for (var loc1=0; loc1<n1; loc1++) {
                var row = [];
                for (var loc0=0; loc0<n0; loc0++) {
                    kji_clone[d0] = loc0;
                    kji_clone[d1] = loc1;
                    var v = this.array_value(kji_clone);
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
            this.container = container;
            if (!container[0].isConnected) {
                throw new Error("scaffolding must be built on a connected DOM element.")
            }
            var contour_side = width * 0.5;
            var slice_side = contour_side * 0.5;
            var slider_breadth = slice_side * 0.1;
            container.empty();
            container.css({
                "display": "grid",
                "grid-template-columns": `${slider_breadth}px ${slice_side}px ${slice_side}px ${contour_side}px`,
                "grid-template-rows": `${slice_side}px ${slice_side}px auto auto`,
                "grid-gap": "3px",
            });

            // Bounded value sliders for I, J, K.
            var j_slider_div = $("<div/>").appendTo(container);
            j_slider_div.html("JS");
            j_slider_div.css({
                "background-color": "#feF",
                "grid-column": "1",
                "grid-row": "1",
                "height": `${slice_side}px`,
            });
            var slider_length = slice_side;
            this.j_slider = new DimSlider(this, 1, j_slider_div, false, slider_length, slider_breadth);

            var k_slider_div = $("<div/>").appendTo(container);
            k_slider_div.html("KS");
            k_slider_div.css({
                "background-color": "#feF",
                "grid-column": "1",
                "grid-row": "2",
                "height": `${slice_side}px`,
            });
            this.k_slider = new DimSlider(this, 0, k_slider_div, false, slider_length, slider_breadth);

            var i_slider_div = $("<div/>").appendTo(container);
            i_slider_div.html("IS");
            i_slider_div.css({
                "background-color": "#feF",
                "grid-column": "2",
                "grid-row": "3",
            });
            this.i_slider = new DimSlider(this, 2, i_slider_div, true, slider_length, slider_breadth);

            this.dim_sliders = [this.i_slider, this.j_slider, this.k_slider];

            // volume slices
            var x_div = $("<div/>").appendTo(container);
            x_div.html("X DIV HERE");
            x_div.css({
                "background-color": "#fee",
                "grid-column": "3",
                "grid-row": "1",
                "height": `${slice_side}px`,
            });
            // X slicer shows Z in columns and Y in rows
            this.x_slicer = new Slicer32(this, [0,1], x_div, slice_side);

            var y_div = $("<div/>").appendTo(container);
            y_div.html("Y DIV HERE");
            y_div.css({
                "background-color": "#efe",
                "grid-column": "2",
                "grid-row": "2",
                "height": `${slice_side}px`,
            });
            // Y slicer shows X in columns and Z in rows
            this.y_slicer = new Slicer32(this, [2,0], y_div, slice_side);

            var z_div = $("<div/>").appendTo(container);
            z_div.html("Z DIV HERE");
            z_div.css({
                "background-color": "#eef",
                "grid-column": "2",
                "grid-row": "1",
                "height": `${slice_side}px`,
            });
            // Z slicer shows X in columns and Y in rows
            this.z_slicer = new Slicer32(this, [2,1], z_div, slice_side);

            var dots_div = $("<div/>").appendTo(container);
            dots_div.html("DOTS DIV HERE");
            dots_div.css({
                "background-color": "#fef",
                "grid-column": "3",
                "grid-row": "2",
                "height": `${slice_side}px`,
            });
            this.initialize_voxels(dots_div);

            var contour_div = $("<div/>").appendTo(container);
            contour_div.html("CONTOUR DIV HERE");
            contour_div.css({
                "background-color": "#eff",
                "grid-column": "4",
                "grid-row": "1 / 3",
                "height": `${contour_side}px`,
            });
            this.initialize_surface_display(contour_div);

            this.slice_displays = [this.x_slicer, this.y_slicer, this.z_slicer];

            // info area
            this.info_area = $("<div/>").appendTo(container);
            this.info_area.css({
                "background-color": "#eff",
                "grid-column": "3",
                "grid-row": "3",
            });
            this.info = $("<div/>").appendTo(this.info_area);

            this.slice_info = $("<div/>").appendTo(container);
            
            this.slice_info.css({
                "background-color": "#ffe",
                "grid-column": "3",
                "grid-row": "4",
            });

            // button area
            var button_area = $("<div/>").appendTo(container);
            
            button_area.css({
                "background-color": "#eff",
                "grid-column": "4",
                "grid-row": "4",
            });
            this.zoom_out_button = $("<button>Zoom out</button>").appendTo(button_area);
            this.zoom_out_button.click(function() { that.zoom_out(); });

            this.focus_button = $("<button>Focus</button>").appendTo(button_area);
            this.focus_button.click(function() { that.focus_volume(); });

            this.sync_button = $("<button>sync</button>").appendTo(button_area);
            this.sync_button.click(function() { that.redraw(true); });

            var auto_sync = $("<span> auto</span>").appendTo(button_area)
            this.sync_check = $('<input type="checkbox" checked/>').appendTo(auto_sync);
            this.sync_check.change(function() {
                var sync = that.sync_check.is(':checked');
                if (sync) {
                    var threshold = that.array_value(that.kji);
                    that.set_threshold(threshold);
                    that.redraw();
                }
            });

            var wires = $("<span> wires</span>").appendTo(button_area)
            this.wires_check = $('<input type="checkbox"/>').appendTo(wires);
            this.wires_check.change(function() {
                that.redraw();
            });

            var track = $("<span> Track</span>").appendTo(button_area)
            this.track_check = $('<input type="checkbox"/>').appendTo(track);
            this.tracking = false;
            this.track_check.change(function() {
                that.tracking = that.track_check.is(":checked");
            });

            this.cutting = false;
            if (this.supports_cutting) {
                var cut = $("<span> CUT</span>").appendTo(button_area)
                this.cut_check = $('<input type="checkbox"/>').appendTo(cut);
                this.cut_check.change(function() {
                    that.cutting = that.cut_check.is(":checked");
                });
            }

            // threshold slider
            var slider =  $("<div/>").appendTo(container);
            slider.css({
                "background-color": "#eff",
                "grid-column": "4",
                "grid-row": "3",
            });
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
                //that.threshold = threshold;
                if (that.threshold != threshold) {
                    that.threshold = threshold;
                    if (that.supports_cutting) {
                        that.cut_check.prop("checked", false);
                        that.cutting = false;
                    }
                }
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
            this.update_slice_info();
            //this.animate()
            // render on change
            this.voxelControls.addEventListener('change', function() { 
                that.request_render(); 
            });
            this.request_render();
        };
        set_tracking(onoff) {
            this.tracking = onoff;
            this.track_check.prop("checked", onoff);
            //this.dragging_slice = null;
        };
        set_threshold(value) {
            value = value || this.bmin
            value = Math.min(this.bmax, Math.max(this.bmin, value));
            this.threshold = value;
            this.threshold_slider.slider("option", "value", value);
        };
        zoom_out() {
            var s = this.settings;
            var cz0 = 0.5 * (s.num_cols - 1);
            var cy0 = 0.5 * (s.num_rows - 1);
            var cx0 = 0.5 * (s.num_layers - 1);
            var center = this.vsum(
                this.vscale(cz0, s.dk),
                this.vsum(
                    this.vscale(cy0, s.dj),
                    this.vscale(cx0, s.di)
                )
            );
            var [cx, cy, cz] = center;
            var r = Math.max(cx, cy, cz)  * 2;
            var crossing = this.surface.crossing;
            var shift = 2.0;
            //crossing.reset_three_camera(this.surface_camera, shift, null, r, cx, cy, cz);
            //crossing.reset_three_camera(this.voxel_camera, shift, this.voxelControls, r, cx, cy, cz);
            this.reset_camera(this.surface_camera, shift, null, r, cx, cy, cz);
            this.reset_camera(this.voxel_camera, shift, this.voxelControls, r, cx, cy, cz);
        }
        point_size() {
            var s = this.settings;
            // the avg dimension offset
            var offset = (this.vnorm(s.di) + this.vnorm(s.dj) + this.vnorm(s.dk)) / 3.0;
            return offset;
        };
        focus_volume() {
            var crossing = this.surface.crossing;
            var shift = 2.0;
            //crossing.reset_three_camera(this.surface_camera, shift);
            //crossing.reset_three_camera(this.voxel_camera, shift, this.voxelControls);
            this.reset_camera(this.surface_camera, shift);
            this.reset_camera(this.voxel_camera, shift, this.voxelControls);
        };
        show_info() {
            var index_order = [this.kji[2], this.kji[1], this.kji[0], ];
            this.info.html("indices: " + index_order + ", threshold: " + this.threshold.toExponential(2))
        };
        update_volume() {
            var surface = this.surface;
            this.set_limits();
            surface.set_threshold(this.threshold);
            var xyz_block = null;
            if (this.cutting) {
                var [k, j, i] = this.kji;
                xyz_block = [i, j, k, 0];  // ???
            }
            surface.set_seed(xyz_block);
            surface.run();
            //this.voxel_mesh.update_sphere_locations(surface.crossing.compact_locations);
            this.set_sphere_locations();
            var wires = this.wires_check.is(":checked");
            this.surface_material.wireframe = wires;
            if (surface.check_update_link) {
                surface.check_update_link();
            }
        };
        set_sphere_locations() {
            var surface = this.surface;
            this.voxel_mesh.update_sphere_locations(surface.crossing.compact_locations);
        };
        redraw(sync) {
            if (!sync) {
                sync = this.sync_check.is(':checked');
            }
            this.slice_displays.map(x => x.draw_frame());
            this.dim_sliders.map(x => x.update_display());
            this.update_slice_info();
            this.kji_mesh.position.set(...this.kji);
            if (sync) {
                this.update_volume();
            }
            this.show_info();
            this.request_render();
        };
    };

    class MarchingCubesVolume32 extends Volume32 {
        // Volumw implemented using marching cubes
        custom_initialization() {
            // not yet implemented...
            this.supports_cutting = true;
        };
        get_surface(options) { 
            return $.fn.webGL2MarchingCubes(options);
        };
        camera_owner() {
            return this;
        };
        reset_three_camera(camera, radius_multiple, orbit_control, radius, cx, cy, cz, up, offset) {
            // adjust three.js camera to look at current voxels
            // xxxx cut/paste and modified from feedbackSurface.js
            var marching = this.surface;
            up = up || {x: 0, y:1, z:0};
            offset = offset || {x: 0, y:0, z:1};
            if (!radius) {
                if ((!marching) || (!marching.mins)) {
                    // no points -- punt
                    return;
                }
                [cx, cy, cz] = marching.mid_point;
                radius = marching.radius;
            }
            radius_multiple = radius_multiple || 3;
            var radius_shift = radius_multiple * radius;
            camera.position.x = cx + radius_shift * offset.x;
            camera.position.y = cy + radius_shift * offset.y;
            camera.position.z = cz + radius_shift * offset.z;
            camera.up = new THREE.Vector3(up.x, up.y, up.z);
            camera.lookAt(new THREE.Vector3(cx, cy, cz));
            if (orbit_control) {
                orbit_control.target.set(cx, cy, cz);
                orbit_control.update();
            }
            return camera;
        };
        set_sphere_locations() {
            //var marching = this.surface;
            this.voxel_mesh.update_sphere_locations();
        };
        get_points_mesh() {
            // simplified from $.fn.webGL2crossingVoxels.pointsMesh
            // xxx add autocoloration?
            var marching = this.surface;
            var locations = marching.positions;
            var colors = marching.colors;
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( locations, 3 ) );
            geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
            var [cx, cy, cz] = marching.mid_point;
            var radius = marching.radius;
            geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius);
            geometry.setDrawRange( 0, marching.active_vertex_count );
            // xxx magic constant
            var material = new THREE.PointsMaterial( { 
                size: this.point_size(), 
                //color: 0x885588,
                vertexColors: true,
            } );
            var points = new THREE.Points( geometry, material );
            points.update_sphere_locations = function(s) {
                geometry.attributes.position.array = marching.positions;
                geometry.attributes.position.needsUpdate = true;
                geometry.attributes.color.array = marching.colors;
                geometry.attributes.color.needsUpdate = true;
                geometry.setDrawRange( 0, marching.active_vertex_count );
            };
            return points;
        };
    };

    class DimSlider {
        constructor(volume, dimension, container, horizontal, length, breadth) {
            this.volume = volume;
            this.dimension = dimension;
            this.container = container;
            var shape = volume.shape;
            var maximum = shape[dimension];
            //container.html("D" + dimension + " :: " + maximum);
            var aspect_ratio = breadth * 1.0 / length;
            var on_change = this.on_change_handler();
            container.empty();
            this.slider = container.bounded_value_slider({
                horizontal: horizontal,
                length: length,
                aspect_ratio: aspect_ratio,
                maximum: maximum,
                //on_change: on_change,
                on_stop: on_change,
                call_on_init: false,
                integral: true,
            });
        };
        on_change_handler() {
            var that = this;
            var volume = this.volume;
            var dimension = this.dimension;
            return function(values) {
                var maxes = volume.grid_maxes;
                var mins = volume.grid_mins;
                var kji = volume.kji;
                maxes[dimension] = values.HIGH;
                kji[dimension] = values.CURRENT;
                mins[dimension] = values.LOW;
                if (values.last_changed == "CURRENT") {
                    var threshold = volume.array_value(kji);
                    volume.set_threshold(threshold);
                } else {
                    volume.redraw();
                }
                //volume.redraw();
            };
        };
        update_display() {
            var volume = this.volume;
            var dimension = this.dimension;
            var maxes = volume.grid_maxes;
            var mins = volume.grid_mins;
            var kji = volume.kji;
            var slider = this.slider;
            slider.update_model("HIGH", maxes[dimension]); 
            slider.update_model("LOW", mins[dimension]); 
            slider.update_model("CURRENT", kji[dimension]);
        }
    };

    var cross_hairs_normal = "rgba(0,0,0,0.5)";
    var cross_hairs_cut = "rgba(255,0,0,1)";

    class Slicer32 {
        constructor(volume, dimensions, container, side) {
            this.volume = volume;
            this.container = container;
            // indices for row and column in this slice (not the sliced dimension)
            this.dimensions = dimensions;
            this.side = side;
            var d0, d1;
            [d0, d1] = dimensions;
            //var names = ["Z", "Y", "X"];
            var names = ["K", "J", "I"];
            this.name = "slice(" + d0 + "," + d1 + ")";
            this.hname = names[d0];
            this.vname = names[d1];
            var vshape = volume.shape;
            this.shape = [vshape[d0], vshape[d1]];
            var [s0, s1] = this.shape;
            //var maxdim = Math.max(...this.shape);
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
                0, 0, s0, s1,
            );
            this.wframe_factor = side * 1.0 / s0;
            this.hframe_factor = side * 1.0 / s1;
            this.radius_factor = Math.min(this.wframe_factor, this.hframe_factor);
            this.dragging = null;
            //this.cross_hairs_color = "rgba(0,0,0,0.5)";
            this.draw_frame();
        };

        draw_frame() {
            var d0, d1, i0, i1;
            var volume = this.volume;
            var frame = this.frame;
            var that = this;
            [i0, i1] = this.dimensions;
            [d0, d1] = this.shape;
            var grid_mins = [volume.grid_mins[i0], volume.grid_mins[i1]];
            var grid_maxes = [volume.grid_maxes[i0], volume.grid_maxes[i1]];
            /*
            if (volume.dragging_slice == that) {
                // update the min/max marker rects
                //this.Mins.change({x: grid_mins[0], y: grid_mins[1]});
                //this.Maxes.change({x: grid_maxes[0], y: grid_maxes[1]});
                this.m0.change({x: grid_mins[0], y:0, w:-grid_mins[0], h:d1,});
                this.m1.change({x: 0, y:grid_mins[1], w:d0, h:-grid_mins[1],});
                this.M0.change({x: grid_maxes[0], y:0, w:d0-grid_maxes[0], h:d1,});
                this.M1.change({x: 0, y:grid_maxes[1], w:d0, h:d1-grid_maxes[1],});
                // don't replot the dragging frame
                return;
            }
            */
            //var m = this.maxdim;
            var blue = [0,0,255,255]
            var yellow = [255,255,0,255]
            frame.reset_frame();
            //var event_rect = frame.frame_rect({x:-1, y:-1, w:d0+1, h:d1+1, color:"rgba(0,0,0,0)", name:"event_rect"})
            var slice_info = this.volume.array_slice(this.volume.kji, this.dimensions);
            this.container.name_image_data(self.name, slice_info.bytes, slice_info.cols, slice_info.rows, blue, yellow);
            //var ff = this.frame_factor;
            var wf = this.wframe_factor;
            var hf = this.hframe_factor;
            frame.named_image({image_name: self.name, x:0, y:0, w:wf*slice_info.cols, h:hf*slice_info.rows})
            frame.lower_left_axes({
                min_x:0, min_y:0, max_x:this.shape[0], max_y:this.shape[1],
                x_anchor: 0, y_anchor:0, max_tick_count:3,
            });
            var font =  "normal 20px Courier"
            frame.text({x:-0.1*d0, y:d1 * 0.5, align:"right", text: this.vname, font:font})
            frame.text({y:-0.1*d1, x:d0 * 0.5, text: this.hname, degrees:-90, font:font})
            // circles marking crossing pixels
            var threshold = this.volume.threshold;
            var mins = slice_info.mins;
            var maxes = slice_info.maxes;
            var rf = this.radius_factor;
            for (var i=0; i<d0; i++) {
                for (var j=0; j<d1; j++) {
                    var m = mins[j][i];
                    var M = maxes[j][i];
                    if ((m <= threshold) && (M >= threshold)) {
                        frame.circle({x: i + 0.5, y: j + 0.5, fill:false, color:"white", r: rf * 0.35});
                    }
                }
            }
            // highlight kji point
            var hx = this.volume.kji[i0] + 0.5;
            var hy = this.volume.kji[i1] + 0.5;
            var cccolor = cross_hairs_normal;
            if (volume.tracking) {
                cccolor = cross_hairs_cut;
            }
            frame.line({x1:0, y1:hy, x2:d0, y2:hy, color:cccolor, lineWidth:2});
            frame.line({x1:hx, y1:0, x2:hx, y2:d1, color:cccolor, lineWidth:2});
            //frame.line({x1:0, y1:hy, x2:d0, y2:hy, color:this.cross_hairs_color});
            //frame.line({x1:hx, y1:0, x2:hx, y2:d1, color:this.cross_hairs_color});
            frame.circle({x: hx, y:hy, r:rf * 0.25, color:"rgba(255,255,255,0.7)"});
            frame.circle({x: hx, y:hy, r:rf * 0.25, color:"black", fill:false});

            // min boundaries
            this.m0 = frame.frame_rect({x: grid_mins[0], y:0, w:-grid_mins[0], h:d1, color:"rgba(255,255,255,0.5)", name:true});
            this.m1 = frame.frame_rect({x: 0, y:grid_mins[1], w:d0, h:-grid_mins[1], color:"rgba(255,255,255,0.5)", name:true});
            // max boundaries
            this.M0 = frame.frame_rect({x: grid_maxes[0], y:0, w:d0-grid_maxes[0], h:d1, color:"rgba(255,255,255,0.5)", name:true});
            this.M1 = frame.frame_rect({x: 0, y:grid_maxes[1], w:d0, h:d1-grid_maxes[1], color:"rgba(255,255,255,0.5)", name:true});

            /*
            // boundary draggers
            var Mins = frame.rect({x: grid_mins[0], y: grid_mins[1], w:-20, h:-20, color:"black", name:"Mins"})
            var Maxes = frame.rect({x: grid_maxes[0], y: grid_maxes[1], w:20, h:20, color:"black", name:"Maxes"})
            this.Mins = Mins;
            this.Maxes = Maxes;

            this.container.fit(null, 10);

            // events
            var event_info_dump = function(event) {
                if (!volume.dump_events) {
                    return;
                }
                var name = event.canvas_name;
                var type = event.type;
                var dragging = that.dragging;
                volume.info.html("event name: " + name + ", type: " + type + ", dragging=" +dragging);
            };
            */

            // rectangle for receiving events -- on top of all other artifacts
            var event_rect = frame.frame_rect({x:-1, y:-1, w:d0+1, h:d1+1, color:"rgba(0,0,0,0)", name:"event_rect"})

            var click = function(event) {
                //event_info_dump(event);
                volume.set_tracking(false);
                //cl("click: " + event.canvas_name);
                //if (volume.dragging_slice == that) {
                //    //cl("click: let mouse up handler deal with it...");
                //    return;
                //}
                //cl("click: resetting kji");
                //volume.dragging_slice = null;
                that.set_kji(event);
            };
            event_rect.on("click", click);


            var mouse_move = function(event) {
                //event_info_dump(event);
                if (volume.tracking) {
                    that.set_kji(event);
                    return;
                }
            };
            event_rect.on("mousemove", mouse_move);

            /*
            //this.dragging = null;
            var mouse_down = function(event) {
                event_info_dump(event);
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
                event_info_dump(event);
                if (volume.tracking) {
                    that.set_kji(event);
                    return;
                }
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
            //event_rect.on("mousemove", mouse_move);
            var rects = [event_rect, this.m0, this.m1, this.M0, this.M1, this.Mins, this.Maxes];
            for (var i=0; i<rects.length; i++) {
                rects[i].on("mousemove", mouse_move);
            }

            var mouse_up = function(event) {
                //cl("mouse_up")
                event_info_dump(event);
                that.dragging = null;
                volume.dragging_slice = null;
            };
            this.container.on_canvas_event("mouseup", mouse_up);
            //this.container.on_canvas_event("mouseout", mouse_up);
            // attach to mouseout jQuery event (not canvas event)
            //this.container.on("mouseout", mouse_up);
            */
            this.container.fit(null, 5);
        };
        set_kji(event) {
            // set the kji focus and the threshold and redraw
            var that = this;
            var frame_location = that.frame.event_model_location(event);
            var x = Math.floor(frame_location.x);
            var y = Math.floor(frame_location.y);
            var [d0, d1] = this.shape;
            if ((x >= 0) && (x < d0) && (y >= 0) && (y < d1)) {
                var [i0, i1] = that.dimensions;
                that.volume.kji[i0] = x;
                that.volume.kji[i1] = y;
                //that.volume.threshold = 0.5 * (mins[y][x] + maxes[y][x]);
                //var mins = that.slice_info.mins;
                //var maxes = that.slice_info.maxes;
                //var threshold = 0.5 * (mins[y][x] + maxes[y][x]);
                var sync = that.volume.sync_check.is(':checked');
                if (sync) {
                    var threshold = that.volume.array_value(that.volume.kji);
                    that.volume.set_threshold(threshold);
                }
                //that.volume.redraw(); redraw is triggered by set_threshold
            }
        };
    };

    // helper: get a properly configured webgl context
    var get_webgl_context = function(from_canvas) {
        var options = {
            alpha: false,  // I think three.js requires this?
            preserveDrawingBuffer: true,  // make it possible get the pixel data after render.
        }
        return from_canvas.getContext( 'webgl2', options ); 
    }

    $.fn.volume32 = function (options) {
        return new Volume32(options);
    };

    $.fn.marching_cubes32 = function (options) {
        return new MarchingCubesVolume32(options);
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
        var V = container.marching_cubes32({
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