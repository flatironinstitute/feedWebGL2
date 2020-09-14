
"""
Jupyter widget for viewing a dense 3d matrix.
"""

from . import local_files
import numpy as np
import jp_proxy_widget
from jp_doodle.data_tables import widen_notebook
from jp_doodle import dual_canvas
from IPython.display import display

required_javascript_modules = [
    local_files.vendor_path("js_lib/three.min.js"),
    local_files.vendor_path("js_lib/OrbitControls.js"),
    local_files.vendor_path("js/feedWebGL.js"),
    local_files.vendor_path("js/feedbackSurfaces.js"),
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
        self.options = None
        self.data = None

    def set_options(
            self, num_rows, num_cols, num_layers, 
            threshold=0, shrink_factor=0.2, method="tetrahedra",
            ):
        methods = ("tetrahedra", "diagonal")
        assert method in methods, "method must be in " + repr(methods)
        options = jp_proxy_widget.clean_dict(
            num_rows=num_rows, num_cols=num_cols, num_layers=num_layers, 
            threshold=threshold, shrink_factor=shrink_factor, method=method,
        )
        self.options = options
        self.js_init("""
            element.V = element.volume32(options);
        """, options=options)

    def load_3d_numpy_array(
            self, ary, 
            threshold=None, shrink_factor=None, chunksize=10000000, method="tetrahedra",
            ):
        if not self.rendered:
            display(self)
        if threshold is None:
            threshold = 0.5 * (ary.min() + ary.max());
        self.element.html("Loading shape: " + repr(ary.shape) + " " + repr([threshold, shrink_factor]))
        (num_layers, num_cols, num_rows) = ary.shape
        if shrink_factor is None:
            shrink_factor = self.shrink_heuristic(*ary.shape)
        ary32 = np.array(ary, dtype=np.float32)
        self.set_options(
            num_rows, num_cols, num_layers, 
            threshold=threshold, shrink_factor=shrink_factor, method=method)
        self.data = ary32
        ary_bytes = bytearray(ary32.tobytes())
        nbytes = len(ary_bytes)
        self.js_init("""
            debugger;
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

    def triangles_and_normals(self):
        from jp_proxy_widget.hex_codec import hex_to_bytearray
        float_count = self.element.position_count().sync_value()
        positions_hex = self.element.get_positions_bytes().sync_value()
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
        normals = float32array(normals_hex)
        return (positions, normals)

    shrink_multiple = 4.0
    shrink_max = 0.7

    def shrink_heuristic(self, n, m, k):
        c = (n*m + m*k + n*k) * self.shrink_multiple / (n*m*k)
        return min(c, self.shrink_max)

    def build(self, width=1200):
        assert self.options is not None, "options must be intialized"
        assert self.data is not None, "data must be provided"
        self.element.html("building")
        self.element.V.build_scaffolding(self.get_element(), width)
        self.element.V.focus_volume()

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

def display_isosurface(for_array, threshold=None, save=False, method="tetrahedra"):
    W = Volume32()
    W.load_3d_numpy_array(for_array, threshold=threshold, method=method)
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
    