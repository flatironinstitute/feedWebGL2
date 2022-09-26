
// jQuery plugin for webGL three.js based surfaces display
//
// structure matches surfaces_sequence.py

(function($) {

    $.fn.surfaces_sequence = function(options) {
        return new SurfacesSequence(options);
    };

    var division_list = function(list, multiplier) {
        // rescale int multiples to floats
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

    class SurfaceInfo {
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
            // max/min position not used here...
        };
    };

    class NamedSurface {
        constructor(options) {
            this.settings = $.extend({
                // defaults
            }, options);
            var s = this.settings;
            var surfaces_settings = s.surfaces;
            var surface_infos = {};
            for (var name in surfaces_settings) {
                var ss = surfaces_settings[name];
                var si = new SurfaceInfo(ss);
                surface_infos[name] = si;
            }
            this.surfaces = surface_infos;
            // max/min position not used here...
        };
        set_arrays() {
            // combine arrays from surface components
            var npos = 0;
            var nindices = 0;
            var surfaces = this.surfaces;
            for (var name in this.surfaces) {
                var s = surfaces[name];
                npos += s.positions.length;
                nindices += s.indices.length;
            }
            var all_indices = new Int32Array(nindices);
            var all_positions = new Float32Array(npos);
            var all_normals = new Float32Array(npos);
            var all_colors = new Float32Array(npos);
            var last_position = 0;
            var last_index = 0;
            for (var name in this.surfaces) {
                var s = surfaces[name];
                var p = s.positions;
                var plen = p.length;
                var next_position = last_position + plen
                all_positions.set(p, last_position);
                all_normals.set(s.normals, last_position);
                var c = s.color;
                for (var ci=last_position; ci < next_position; ci+=3) {
                    all_colors.set(c, ci);
                }
                var ind = s.indices;
                // shift indices
                var ishift = last_position / 3;
                var ilen = ind.length;
                var next_index = last_index + ilen;
                for (var i=0; i<ilen; i++) {
                    all_indices[last_index + i] = ind[i] + ishift;
                }
                last_position = next_position;
                last_index = next_index;
            }
            this.indices = all_indices;
            this.positions = all_positions;
            this.colors = all_colors;
            this.normals = all_normals;
        }
    };

    class SurfacesSequence {
        constructor(options) {
            this.settings = $.extend({
                // defaults
                ClearColorHex:  0xffffff,
            }, options);
            var s = this.settings;
            var multiplier = s.multiplier;
            this.diameter = s.diameter;
            this.center = division_list(s.center, multiplier);
            var sq_json = s.sequence;
            var sequences = [];
            for (var i=0; i<sq_json.length; i++) {
                var sj = sq_json[i];
                var ss = new NamedSurface(sj);
                sequences.push(ss)
            }
            this.sequences = sequences;
            // max/min position not used here...
        };
        load_3d_display(container, radius_multiple) {
            var that = this;
            var s = this.settings;
            radius_multiple = radius_multiple || 1;
            container.empty();
            var canvas = document.createElement( 'canvas' );
            var context = canvas.getContext( 'webgl2', { alpha: false } ); 
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
            var sequence = this.sequences[this.current_index];
            sequence.set_arrays();

            var vertices = sequence.positions;
            var normals = sequence.normals;
            var colors = sequence.colors;
            var indices = Array.from( sequence.indices );
        
            var geometry = new THREE.BufferGeometry();
            this.geometry = geometry;
            geometry.setIndex( indices );
            geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
            geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
            geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );

            const material = new THREE.MeshPhongMaterial( {
                //side: THREE.DoubleSide,
                side: THREE.BackSide,
                vertexColors: true,
                opacity: 0.5,
                transparent: true,
            } );
            //material.depthWrite = false
            this.material = material;

            var mesh = new THREE.Mesh( geometry, material );
            this.mesh = mesh;
            scene.add( mesh );

            renderer.render(scene, camera);

            var orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
            this.orbitControls = orbitControls;
            //orbitControls.center.set( cx, cy, cz );
            orbitControls.target.set( cx, cy, cz );
            orbitControls.update();
            //renderer.render(scene, camera);
            // orbitControls.userZoom = false;
            var clock = new THREE.Clock();
            this.clock = clock;
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
            this.ts_info = $("<div>Setting up display.</div>").appendTo(container);
        };
        update_opacity() {
            var opacity = this.opacity_slider.slider("option", "value");
            this.material.opacity = opacity;
        };
        update_timestamp() {
            var tsindex = this.slider.slider("option", "value");
            this.ts_info.html("Timestamp index: " + tsindex);
            this.current_index = tsindex
            var sequence = this.sequences[this.current_index];
            sequence.set_arrays();

            var vertices = sequence.positions;
            var normals = sequence.normals;
            var colors = sequence.colors;
            var indices = Array.from( sequence.indices );

            var geometry = this.geometry;

            geometry.setIndex( indices );
            geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
            geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
            geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
            // don't adjust the camera
        };
        animate() {
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
             );};
    };
})(jQuery);
