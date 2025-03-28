
/*
Refactor of surfaces_sequence.js to allow different surfaces to have different opacity.
*/

(function($) {
    $.fn.surfaces_display = function(options) {
        var result = new SurfacesDisplay(options);
        console.log("surfaces_display", result);
        return result;
    };

    class SurfacesDisplay {
        constructor(options) {
            this.settings = $.extend({
                // defaults
                ClearColorHex:  0xffffff,
                wireframe: false,
            }, options);
            var s = this.settings;
            var multiplier = s.multiplier;
            this.diameter = s.diameter;
            this.center = division_list(s.center, multiplier);
            var sq_json = s.sequence;
            var sequences = [];
            var all_colors = {}
            var max_surface_count = 0;
            for (var i=0; i<sq_json.length; i++) {
                var sj = sq_json[i];
                var ss = new TimeStamp(sj);
                sequences.push(ss)
                max_surface_count = Math.max(max_surface_count, ss.surfaces.length);
                for (var color in ss.colors) {
                    all_colors[color] = ss.colors[color];
                };
            }
            this.all_colors = all_colors;
            this.opaque_colors = {};
            this.max_surface_count = max_surface_count;
            this.sequences = sequences;
        };

        load_3d_display(container, radius_multiple) {
            debugger;
            this.ts_info = $("<div>Setting up display.</div>").appendTo(container);
            var that = this;
            var s = this.settings;
            radius_multiple = radius_multiple || 1;
            container.empty();
            var canvas = document.createElement( 'canvas' );
            this.canvas = canvas;
            var context_attrs = { 
                alpha: true,
                preserveDrawingBuffer: true,
            } 
            var context = canvas.getContext( 'webgl2', context_attrs ); 
            this.canvas_context = context;
            var renderer = new THREE.WebGLRenderer( { canvas: canvas, context: context } );
            renderer.setClearColor(s.ClearColorHex);
            this.renderer = renderer;
            renderer.setPixelRatio( window.devicePixelRatio );
            renderer.setSize( container.width(), container.height() );
            renderer.outputEncoding = THREE.sRGBEncoding;
            container[0].appendChild( renderer.domElement );
            var camera = new THREE.PerspectiveCamera( 45, container.width()/container.height(), 0.1, 10000 );
            this.camera = camera;
            var scene = new THREE.Scene();
            this.scene = scene;
            var center = this.center;
            var radius = this.diameter;
            var cx = center[0];
            var cy = center[1];
            var cz = center[2];
            //var radius_multiple = 2.0;
            var sr = radius * radius_multiple;

            var light = new THREE.DirectionalLight( 0xffffff );
            light.position.set( cx+sr, cy+sr, cz+sr );
            scene.add( light );
        
            light = new THREE.DirectionalLight( 0x995555 );
            light.position.set( cx+sr, cy-sr, cz-sr );
            scene.add( light );
        
            light = new THREE.DirectionalLight( 0x555599 );
            light.position.set( cx-sr, cy-sr, cz+sr );
            scene.add( light );
        
            light = new THREE.DirectionalLight( 0x559955 );
            light.position.set( cx-sr, cy+sr, cz-sr );
            scene.add( light );
        
            camera.position.x = cx;
            camera.position.y = cy;
            camera.position.z = cz + radius * radius_multiple;
            camera.lookAt(new THREE.Vector3(cx, cy, cz));

            var boundary_sphere = false;
            if (boundary_sphere) {
                var g = new THREE.SphereGeometry(radius, 12, 12);
                var m = new THREE.MeshNormalMaterial();
                m.wireframe = true;
                var c = new THREE.Mesh(g, m);
                c.position.set(cx, cy, cz);
                scene.add(c);
            }

            this.current_index = 0;

            // make enough surface meshes with empty geometries
            var max_surface_count = this.max_surface_count;
            var meshes = [];
            var geometries = [];
            for (var i=0; i<max_surface_count; i++) {
                var geometry = new THREE.BufferGeometry();
                geometry.setIndex( [] );
                geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [], 3 ) );
                geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( [], 3 ) );
                geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( [], 3 ) );
                geometries.push(geometry);
                const material = new THREE.MeshPhongMaterial( {
                    side: THREE.DoubleSide,
                    //side: THREE.BackSide,
                    //vertexColors: true,
                    opacity: 0.5,
                    transparent: true,
                    wireframe: this.settings.wireframe,
                } );
                var mesh = new THREE.Mesh(geometry, material);
                meshes.push(mesh);
                scene.add(mesh);
            };
            this.meshes = meshes;
            this.geometries = geometries;

            //renderer.render(scene, camera);

            var orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
            this.orbitControls = orbitControls;
            //orbitControls.center.set( cx, cy, cz );
            orbitControls.target.set( cx, cy, cz );
            orbitControls.update();
            //renderer.render(scene, camera);
            // orbitControls.userZoom = false;
            var clock = new THREE.Clock();
            this.clock = clock;
            this.set_timestamp(0);
            this.animate();

            // set up slider if there are many timestamps
            var nseq = this.sequences.length;
            if (nseq > 1) {
                var slider = $("<div/>").appendTo(container);
                slider.css("background-color", "#999")
                this.slider = slider;
                slider.width(container.width());
                var update_timestamp = function() { that.update_timestamp() };
                slider.slider({
                    value: 0,
                    slide: update_timestamp,
                    change: update_timestamp,
                    min: 0,
                    max: nseq - 1,
                    step: 1,
                });
            }
            // opacity slider
            var slider_bar = $("<div/>").appendTo(container);
            slider_bar.css({"display": "flex", "flex-direction": "row"});
            $("<div>opacity</div>").appendTo(slider_bar);
            var opacity_slider = $("<div/>").appendTo(slider_bar);
            opacity_slider.width(300);
            var update_opacity = function() { that.update_opacity(); };
            opacity_slider.slider({
                value: 0.5,
                slide: update_opacity,
                change: update_opacity,
                min: 0,
                max: 1.0,
                step: 0.05,
            });
            this.opacity_slider = opacity_slider;
            //this.ts_info = $("<div>Setting up display.</div>").appendTo(container);
        };
        update_opacity() {
            var opacity = this.opacity_slider.slider("option", "value");
            // set opacity of all meshes not marked opaque.
        };
        update_timestamp() {
            var tsindex = this.slider.slider("option", "value");
            this.set_timestamp(tsindex);
        };

        set_timestamp(tsindex) {
            this.ts_info.html("Timestamp index: " + tsindex);
            this.current_index = tsindex
            var sequence = this.sequences[this.current_index];
            // assign each surface to a mesh
            // clear any remaining meshes (set to empty/black)
            for (var i=0; i<this.meshes.length; i++) {
                var mesh = this.meshes[i];
                var geometry = this.geometries[i];
                var visuals = sequence.get_visuals(i);
                geometry.setIndex( visuals.indices );
                geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( visuals.positions, 3 ) );
                geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( visuals.normals, 3 ) );
                // set the color on the material
                var color = visuals.color;
                var material = mesh.material;
                material.color.setRGB(color[0], color[1], color[2]);
            }
        };

        animate() {
            // standard animate function
            var that = this;
            var delta = this.clock.getDelta();
            this.orbitControls.update(delta);
            this.renderer.render( this.scene, this.camera );
            //normals.sync_camera(that.camera);
            //velocities.sync_camera(that.camera);
            requestAnimationFrame( 
                function () {
                    that.animate();
                }
             );
        };
    };

    class TimeStamp {
        constructor(options) {
            this.settings = $.extend({
                // defaults
            }, options);
            var s = this.settings;
            var surfaces_settings = s.surfaces;
            var surface_infos = [];
            var rgb_colors = {};
            for (var name in surfaces_settings) {
                var ss = surfaces_settings[name];
                var si = new Surface(ss);
                surface_infos.push(si);
                rgb_colors[si.rgb_color] = si;
            }
            this.colors = rgb_colors;
            this.surfaces = surface_infos;
        };
        get_visuals(for_index) {
            // return the visuals for the surface at the given index, or default to empty
            var surfaces = this.surfaces;
            var indices = [];
            var positions = [];
            var normals = [];
            var color = [0,0,0]
            var rgb_color = "black";
            if (for_index < surfaces.length) {
                var si = surfaces[for_index];
                indices = si.indices;
                positions = si.positions;
                normals = si.normals;
                color = si.color;
                rgb_color = si.rgb_color;
            }
            return {
                indices: indices,
                positions: positions,
                normals: normals,
                color: color,
                rgb_color: rgb_color,
            };
        };
    };

    class Surface {
        constructor(options) {
            this.settings = $.extend({
                // defaults
            }, options);
            var s = this.settings;
            var multiplier = s.multiplier;
            this.indices = s.indices;
            var p = s.positions;
            this.positions = division_list(p, multiplier);
            this.normals = division_list(s.normals, multiplier);
            this.color = division_list(s.color, multiplier);
            var ln = p.length;
            var lnn = this.normals.length;
            if (lnn != ln) {
                throw new Error("normals and positions must match: " + [ln, lnn]);
            }
            if (this.color.length != 3) {
                throw new Error("color should be rgb: " + this.color.length);
            }
            this.position_count = ln / 3;
            this.rgb_color = rgb_color(this.color[0], this.color[1], this.color[2]);
        };
    };

    function rgb_color(floatr, floatg, floatb) {
        var ir = Math.floor(floatr * 255);
        var ig = Math.floor(floatg * 255);
        var ib = Math.floor(floatb * 255);
        // return color as hex string like #ff00ff
        function pad16(x) {
            var s = x.toString(16);
            return s.length == 1 ? "0" + s : s;
        }
        return "#" + pad16(ir) + pad16(ig) + pad16(ib);
    };

    var division_list = function(list, multiplier) {
        // rescale int multiples to floats xxx copied from surfaces_sequence.js
        if ((!multiplier) || (multiplier < 1)) {
            throw new Error("invalid array multiplier: " + multiplier)
        }
        var ln = list.length;
        var result = new Float32Array(ln);
        var scale = 1.0 / multiplier;
        for (var i=0; i<ln; i++) {
            result[i] = list[i] * scale
        }
        return result;
    }

})(jQuery);