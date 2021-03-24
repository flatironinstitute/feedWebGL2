
"""
Jupyter widget for viewing a dense 3d matrix.
"""

from . import local_files
import numpy as np
import jp_proxy_widget
from jp_doodle.data_tables import widen_notebook
from jp_doodle import dual_canvas

# need to add camera positioning support
# https://stackoverflow.com/questions/14271672/moving-the-camera-lookat-and-rotations-in-three-js

required_javascript_modules = [
    local_files.vendor_path("js_lib/three.min.js"),
    local_files.vendor_path("js_lib/OrbitControls.js"),
    local_files.vendor_path("js_lib/three_sprite_text.js"),
    local_files.vendor_path("js/feedWebGL.js"),
    local_files.vendor_path("js/feedbackSurfaces.js"),
    local_files.vendor_path("js/streamLiner.js"),
    local_files.vendor_path("js/volume32.js"),
]

REQUIREMENTS_LOADED = False

def load_requirements(widget=None, silent=True, additional=()):
    """
    Load Javascript prerequisites into the notebook page context.
    """
    global REQUIREMENTS_LOADED
    if REQUIREMENTS_LOADED:
        if not silent:
            print("Not reloading requirements.")
        return
    if widget is None:
        widget = jp_proxy_widget.JSProxyWidget()
        silent = False
    # Make sure jQuery and jQueryUI are loaded.
    widget.check_jquery()
    # load additional jQuery plugin code.
    all_requirements = list(required_javascript_modules) + list(additional)
    widget.load_js_files(all_requirements)
    dual_canvas.load_requirements(widget, silent=silent)
    if not silent:
        widget.element.html("<div>Requirements for <b>volume viewer</b> have been loaded.</div>")
        display(widget)
    REQUIREMENTS_LOADED = True

class Volume32(jp_proxy_widget.JSProxyWidget):

    def __init__(self, *pargs, **kwargs):
        super(Volume32, self).__init__(*pargs, **kwargs)
        load_requirements(self)
        self.element.html("Uninitialized Volume widget.")
        self.js_init("""
            element.ready_sync = function (message) {
                if (!element.V) {
                    element.html(message);
                }
                return true;
            };
        """)
        self.options = None
        self.data = None

    def set_options(
            self, num_rows, num_cols, num_layers, 
            threshold=0, shrink_factor=0.2, method="tetrahedra",
            sorted=True,
            camera_up=None, 
            camera_offset=None,
            camera_distance_multiple=None,
            di=None,
            dj=None,
            dk=None,
            ):
        methods = ("tetrahedra", "diagonal")
        assert method in methods, "method must be in " + repr(methods)
        options = jp_proxy_widget.clean_dict(
            num_rows=num_rows, num_cols=num_cols, num_layers=num_layers, 
            threshold=threshold, shrink_factor=shrink_factor, method=method,
            sorted=sorted,
            camera_up=camera_up, 
            camera_offset=camera_offset,
            camera_distance_multiple=camera_distance_multiple,
            di=di, dj=dj, dk=dk,
        )
        self.options = options
        self.js_init("""
        debugger;
            element.V = element.volume32(options);
        """, options=options)

    def sync(self, message="Volume widget is ready"):
        "Wait for the widget to initialize before proceeding. Widget must be displayed!"
        self.element.ready_sync(message).sync_value()

    def load_stream_lines(
        self, 
        stream_lines, 
        basis_scale=1.0, 
        cycle_duration=1.0,
        sprite_shape_weights=None, 
        sprite_shape_normals=None,
        ):
        """
        Load sequence of sequence of triples as stream lines to the surface display.
        """
        parameters = dict(stream_lines=stream_lines, basis_scale=basis_scale, cycle_duration=cycle_duration)
        if (sprite_shape_normals):
            parameters["sprite_shape_normals"] = sprite_shape_normals
        if (sprite_shape_weights):
            parameters["sprite_shape_weights"] = sprite_shape_weights
        # KISS for now XXXX eventually optimize using bytearrays and numpy?
        self.js_init("""
            element.V.settings.stream_lines_parameters = parameters;
        """, parameters=parameters)

    def load_3d_numpy_array(
            self, ary, 
            threshold=None, shrink_factor=None, chunksize=10000000, method="tetrahedra",
            sorted=True,
            camera_up=dict(x=0, y=1, z=0),
            camera_offset=dict(x=0, y=0, z=1),
            camera_distance_multiple=2.0,
            di=dict(x=1, y=0, z=0),  # xyz offset between ary[0,0,0] and ary[1,0,0]
            dj=dict(x=0, y=1, z=0),  # xyz offset between ary[0,0,0] and ary[0,1,0]
            dk=dict(x=0, y=0, z=1),  # xyz offset between ary[0,0,0] and ary[0,0,1]
            ):
        self.array = ary
        self.dk = self.positional_xyz(dk)
        self.di = self.positional_xyz(di)
        self.dj = self.positional_xyz(dj)
        if not self.rendered:
            display(self)
        if threshold is None:
            threshold = 0.5 * (ary.min() + ary.max());
        self.element.html("Loading shape: " + repr(ary.shape) + " " + repr([threshold, shrink_factor]))
        (num_layers, num_rows, num_cols) = ary.shape
        if shrink_factor is None:
            shrink_factor = self.shrink_heuristic(*ary.shape)
        ary32 = np.array(ary, dtype=np.float32)
        self.set_options(
            num_rows=num_rows, num_cols=num_cols, num_layers=num_layers, 
            threshold=threshold, shrink_factor=shrink_factor, method=method,
            sorted=sorted, 
            camera_up=camera_up, 
            camera_offset=camera_offset,
            camera_distance_multiple=camera_distance_multiple,
            dk=self.dk,
            dj=self.dj,
            di=self.di,
            )
        self.data = ary32
        ary_bytes = bytearray(ary32.tobytes())
        nbytes = len(ary_bytes)
        self.js_init("""
            var uint8array = new Uint8Array(length);
            element.build_status = function(msg) {
                element.html(msg);
            }
            element.set_data = function(uint8, at_index) {
                uint8array.set(uint8, at_index);
            };
            element.load_buffer = function () {
                var valuesArray = new Float32Array(uint8array.buffer);
                element.V.buffer = valuesArray;
                uint8array = null;
            };
            // Retrieving positions and normals -- not chunked.
            var positions_and_normals = null;
            element.position_count = function() {
                // call positions_count to prepare arrays...
                positions_and_normals = element.V.surface.clean_positions_and_normals(false, true);
                return positions_and_normals.positions.length;
            };
            element.get_positions_bytes = function() {
                return new Uint8Array(positions_and_normals.positions.buffer);
            };
            element.get_normals_bytes = function() {
                return new Uint8Array(positions_and_normals.normals.buffer);
            };
            element.get_slicing = function () {
                return element.V.get_array_slicing();
            };
        """, length=nbytes)
        cursor = 0
        while cursor < nbytes:
            next_cursor = cursor + chunksize
            percent = int(next_cursor * 100.0 / nbytes)
            chunk = ary_bytes[cursor:next_cursor]
            self.element.set_data(chunk, cursor).sync_value()
            self.element.build_status("Loaded %s (%s%s)" % (next_cursor, percent, "%"))
            cursor = next_cursor
        self.element.load_buffer().sync_value()
        self.element.build_status("Loaded: " + repr(nbytes))

    def positional_xyz(self, dictionary):
        return [dictionary["x"], dictionary["y"], dictionary["z"], ]

    def current_array_slicing(self):
        slicing = self.element.get_slicing().sync_value(level=5)
        self.last_slicing = slicing
        [[lowI, highI], [lowJ, highJ], [lowK, highK]] = slicing
        return self.array[lowI: highI, lowJ: highJ, lowK: highK]

    def triangles_and_normals(self, just_triangles=False):
        # new implementation should work for larger data sizes
        from . import segmented_caller
        # Must call position_count -- this loads the data from the GPU to javascript.
        float_count = self.element.position_count().sync_value()
        def get_3_by_3(method):
            mbytes = segmented_caller.get_bytes(self, method)
            floats = np.frombuffer(mbytes , dtype=np.float32)
            (ln,) = floats.shape
            assert ln == float_count
            (ntriangles, rem) = divmod(ln, 9)
            assert rem == 0, "triangle arrays should groups of 3 positions with 3 floats each. " + repr((ln, ntriangles, rem))
            result = floats.reshape((ntriangles, 3, 3))
            return result
        positions = get_3_by_3(method=self.element.get_positions_bytes)
        if just_triangles:
            return positions
        normals = get_3_by_3(method=self.element.get_normals_bytes)
        return (positions, normals)

    def triangles_and_normals0(self, just_triangles=False):
        # xxxx old implementation sometimes fails for large data sizes.  historical.  delete eventually.
        from jp_proxy_widget.hex_codec import hex_to_bytearray
        float_count = self.element.position_count().sync_value()
        positions_hex = self.element.get_positions_bytes().sync_value()
        if not just_triangles:
            normals_hex = self.element.get_normals_bytes().sync_value()
        def float32array(hex):
            # xxx this should be a convenience provided in jp_proxy_widget...
            #print("converting", hex)
            bytes_array = hex_to_bytearray(hex)
            floats_array = np.frombuffer(bytes_array, dtype=np.float32)
            #print("got floats", floats_array)
            assert floats_array.shape == (float_count,), "bad data received " + repr((floats_array.shape, float_count))
            triangles = float_count // 9
            return floats_array.reshape((triangles, 3, 3))
        positions = float32array(positions_hex)
        if just_triangles:
            return positions
        normals = float32array(normals_hex)
        return (positions, normals)

    def to_k3d_mesh(self, unify_vertices=False, *mesh_positional_args, **mesh_kw_args):
        """
        Convert current isosurface to a k3d mesh.  K3d must be installed separately
        """
        from . import vertex_unifier
        try:
            import k3d
        except ImportError:
            raise ImportError(
                "feedWebGL2 install does not include k3d as a dependancy " +
                "-- it must be installed separately to use the to_k3d_mesh feature.")
        positions = self.triangles_and_normals(just_triangles=True)
        unifier = None
        if unify_vertices:
            unifier = vertex_unifier.Unifier(positions)
            k3d_vertices = unifier.output_vertices.ravel()
            k3d_indices = unifier.triangles_indices.ravel()
        else:
            k3d_vertices = positions.ravel()
            k3d_indices = np.arange(len(k3d_vertices)/3)
        result = k3d.mesh(k3d_vertices, k3d_indices, side="double", *mesh_positional_args, **mesh_kw_args)
        result.unifier = unifier  # for test and debug xxxx comment out later
        return result

    def dump_to_binary_stl(self, filename="volume.stl", verbose=True):
        if verbose:
            print("Dumping volume snapshot as binary STL to " + filename)
        (positions, normals) = self.triangles_and_normals()
        if verbose:
            print("Dumping ", len(positions), "triangles.")
        file = open(filename, "wb")
        typ = np.dtype(np.float32, "<") # little endian float32
        ityp = np.dtype(np.int32, "<") # little endian int32
        #b = np.array(positions[0,0,0], dtype=typ).tobytes()
        #len(b), b, positions[0,0,0]
        header = (b'BINARY STL HEADER STRING :: ' * 20)[:80]
        ntriangles = len(positions)
        ntriangles_bytes = np.array(ntriangles, dtype=ityp).tobytes()
        file.write(header)
        file.write(ntriangles_bytes)
        trailer = b'\x00\x00'
        def dump_triple(triple):
            assert triple.shape == (3,)
            for i in range(3):
                xi = triple[i]
                bi = np.array(xi, dtype=typ).tobytes()
                file.write(bi)
        for itriangle in range(ntriangles):
            if verbose and (itriangle % 10000) == 0:
                print (itriangle)
            normal = normals[itriangle][0]
            dump_triple(normal)
            for ivertex in range(3):
                vertex = positions[itriangle][ivertex]
                dump_triple(vertex)
            file.write(trailer)
        file.close()
        if verbose:
            print ("wrote binary STL to " + repr(filename))

    shrink_multiple = 4.0
    shrink_max = 0.7

    def shrink_heuristic(self, n, m, k):
        c = (n*m + m*k + n*k) * self.shrink_multiple / (n*m*k)
        return min(c, self.shrink_max)

    def build(self, width=1200):
        assert self.options is not None, "options must be intialized"
        assert self.data is not None, "data must be provided"
        self.element.html("building")
        #self.element.V.build_scaffolding(self.get_element(), width)
        # build the scaffolding on a child div to allow garbage collection on reinit
        self.js_init("""
            element.empty();
            element.V_container = $("<div/>").appendTo(element);
            element.V.build_scaffolding(element.V_container, width);
        """, width=width)
        self.element.V.zoom_out()

    def doodle_diagram(
        self, 
        pixels=700, 
        corners=True,
        all_corners=True,
        triangles=True,
        crossing=True,
        force=False):
        from jp_doodle import nd_frame
        ary = self.data
        (width, height, depth) = ary.shape
        if max(*ary.shape) > 25 and not force:
            raise ValueError("Aborting: array is too large for doodle diagram.")
        threshold = self.element.V.threshold.sync_value()
        swatch = nd_frame.swatch3d(pixels=pixels, model_height=height)
        # rotate the 3d reference frame a bit so we aren't looking straight into the z axis
        center = [width * 0.5, height * 0.5, depth * 0.5]
        radius = width + height + depth
        swatch.orbit(center3d=center, radius=radius, shift2d=(-1, -0.8))
        swatch.orbit_all(center3d=center, radius=radius)
        # draw voxel corner circles (fill if crossing)
        if corners:
            for x in range(width):
                for y in range(height):
                    for z in range(depth):
                        a = ary[x, y, z]
                        color = "blue"
                        if a > threshold:
                            color = "#770" # darker yellow
                        corners = ary[x:x+2, y:y+2, z:z+2]
                        fill = False 
                        #print(x,y,z, corners.max(), threshold, corners.min())
                        if crossing:
                            if (corners.max() > threshold and corners.min() < threshold):
                                fill = True
                        if all_corners or fill:
                            swatch.frame_circle(location=(x,y,z), color=color, r=0.1, fill=fill, lineWidth=3)
        # draw triangles and normals
        if triangles:
            (triangles, normals) = self.triangles_and_normals()
            for (i, triangle) in enumerate(triangles):
                normal = normals[i][0]
                anormal = np.abs(normal)
                color = "rgb(%s,%s,%s)" % tuple(int(x * 255) for x in anormal)
                fillcolor = "rgba(%s,%s,%s,0.3)" % tuple(int(x * 255) for x in anormal)
                tcenter = triangle.mean(axis=0)
                for i in range(3):
                    triangle[i] += 0.2 * (tcenter - triangle[i])
                swatch.polygon(locations=triangle, color=color, fill=False, lineWidth=2)
                swatch.polygon(locations=triangle, color=fillcolor)
                swatch.arrow(location1=tcenter, location2=(tcenter + 0.2 * normal), lineWidth=2, color=color, head_length=0.02)
        swatch.fit(0.6)

def display_isosurface(
        for_array, threshold=None, save=False, method="tetrahedra",
        sorted=True
        ):
    W = Volume32()
    W.load_3d_numpy_array(for_array, threshold=threshold, method=method, sorted=sorted)
    W.build()
    if save:
        return W

class Example:

    def __init__(self):
        from IPython.display import display
        widen_notebook()
    
    def get_array(self):
        x = np.linspace(-1.111, 2, 115)
        y = np.linspace(-1.111, 2, 114)
        z = np.linspace(-1.111, 2, 113)
        xv, yv, zv = np.meshgrid(x, y, z, indexing="ij")
        def distance(x0, y0, z0):
            return np.sqrt((x0-xv) ** 2 + (y0 - yv) ** 2 + (z0 - zv) **2)
        #self.ary = np.minimum(distance(0.3, 0.3, 0.3), distance(-0.7, 0.7, 0.7) / (distance(0.3, -0.7, 0.3)+0.01))
        #self.ary = xv * xv + zv * zv
        ary = (xv*yv + xv*zv + yv*zv)/(xv*yv*zv + 1)
        self.ary = np.maximum(np.minimum(ary, 1.0), -1.0)
        print ("array", self.ary.shape)

    def get_array2(self):
        shape = (nx, ny, nz) = (5,6,7)
        ary = np.zeros(shape, dtype=np.float)
        for x in range(nx):
            for y in range(ny):
                for z in range(nz):
                    ary[x, y, z] = y
        self.ary = ary
        print ("array", self.ary.shape)

    def widget(self):
        W = Volume32()
        self.W = W
        return W

    def run(self):
        W = self.W
        W.load_3d_numpy_array(self.ary, chunksize=300019)
        W.build()
    