"""
This module impolements an interactive visualization tool
to help with registering embryo nuclii using data derived from
3d microscopy timeslices.  It probably may not be useful for any other purpose
(except, perhaps as example usage code for the volume widgeet).
"""

from feedWebGL2 import volume
import h5py
import numpy as np
import os
from PIL import Image, ImageSequence
import glob
from IPython.display import display
import ipywidgets as widgets

class TimeSlice:

    """
    Visualization for a 3d time slice with classifications.
    """

    def __init__(
        self, 
        folder="/Users/awatters/misc/LisaBrown/mouse-embryo/mouse-embryo-nuclei", 
        path_prefix="162954/162954",
        holder=None,
        ):
        print ("ts init", folder, path_prefix)
        self.folder = folder
        self.path_prefix = path_prefix
        self.holder = holder
        self.raster_path_h5 = self.path_must_exist("Orig.h5")
        self.labels_path_tiff = self.path_must_exist("Labels.tiff")
        self.get_raster_array()
        self.get_labels_array()

    def print_info(self):
        print("TimeSlice:")
        r = self.full_raster
        print("    raster", r.shape, "range", r.min(), r.max())
        l = self.full_labels
        print("    labels", l.shape, "range", l.min(), l.max())
        print("    unique labels", self.input_labels)
        print("    labelled range", self.labelled_range)

    def set_array_limits(self, limits):
        [(i, I), (j, J), (k, K)] = limits
        self.limited_raster = self.full_raster[i:I, j:J, k:K]
        self.limited_labels = self.full_labels[i:I, j:J, k:K]

    def get_raster_array(self):
        f = h5py.File(self.raster_path_h5, "r")
        Data = f["Data"]
        self.full_raster = np.array(Data)
        f.close()

    def get_labels_array(self):
        im = Image.open(self.labels_path_tiff)
        L = []
        for i, page in enumerate(ImageSequence.Iterator(im)):
            a = np.array(page)
            L.append(a)
        All = np.zeros( (len(L),) + L[0].shape, dtype=np.int)
        for (i, aa) in enumerate(L):
            All[i] = aa
        self.input_labels = np.unique(All)
        self.full_labels = All
        nzIJK = np.nonzero(All)
        self.labelled_range = [(nz.min(), nz.max()) for nz in nzIJK]

    def filepath(self, suffix):
        return os.path.join(self.folder, self.path_prefix + suffix)

    def path_must_exist(self, suffix):
        path = self.filepath(suffix)
        assert os.path.isfile(path), "Required regular file not found: " + repr(path)
        return path

class SliceComparison:
    def __init__(      
        self, 
        folder="/Users/awatters/misc/LisaBrown/mouse-embryo/mouse-embryo-nuclei", 
        path_prefix1="162954/162954",
        path_prefix2="162111/162111",
        ):
        self.folder = folder
        self.path_prefix1 = path_prefix1
        self.path_prefix2 = path_prefix2
        candidates = self.get_candidate_prefixes()
        if path_prefix1 is None:
            for c in candidates:
                if c != path_prefix2:
                    path_prefix1 = c
        if path_prefix2 is None:
            for c in candidates:
                if c != path_prefix1:
                    path_prefix2 = c
        self.time_slice1 = None
        self.time_slice2 = None
        self.widget = None

    def build_widget_container(self):
        print("Building slice comparison widget...")
        volume.widen_notebook()
        self.title = "Nucleus registration in " + repr(self.folder)
        self.title_html = widgets.HTML(value=self.title)
        self.info = widgets.HTML(value="Slice Comparison initializing.")
        self.slice1_holder = SliceHolder(self)
        self.slice2_holder = SliceHolder(self)
        controls = self.make_controls()
        children = [
            self.title_html,
            self.slice1_holder.make_widget(),
            self.slice2_holder.make_widget(),
            controls,
            self.info,
        ]
        self.time_slice1 = self.load_slice(self.path_prefix1, self.slice1_holder)
        self.time_slice2 = self.load_slice(self.path_prefix2, self.slice2_holder)
        self.check_slices()
        self.widget = widgets.VBox(children=children)
        print("Build complete.")
        return self.widget

    def check_slices(self):
        self.info.value = ("Checking slices...")
        self.time_slice1 = self.slice1_holder.slice
        self.time_slice2 = self.slice2_holder.slice
        if self.interactive():
            self.info.value = ("Slices are loaded...")
            self.select_array_limits()
            self.slice1_holder.display_slice()
            self.slice2_holder.display_slice()
        else:
            self.info.value = ("Slices not ready for display. Please load slices.")

    def select_array_limits(self):
        ts1 = self.time_slice1
        ts2 = self.time_slice2
        r1 = ts1.labelled_range
        r2 = ts2.labelled_range
        r = [(min(m1, m2), max(M1, M2)) for [(m1, M1), (m2, M2)] in zip(r1, r2)]
        self.array_limits = r1
        self.info.value = "labelled array limits: " + repr(r)
        ts1.set_array_limits(r)
        ts2.set_array_limits(r)

    def load_slice(self, prefix, holder):
        print("loading slice", prefix)
        if prefix is not None:
            holder.set_slicing(prefix)
        else:
            holder.reset()

    def make_controls(self):
        temp = widgets.HTML("Controls area initializing...")
        self.controls_area = widgets.HBox(children=[temp])
        return self.controls_area

    def interactive(self):
        return (self.time_slice1 is not None) and (self.time_slice2 is not None) and (self.widget is not None)
    
    def get_candidate_prefixes(self):
        candidates = []
        folder = self.folder
        files = os.listdir(folder)
        for filename in files:
            if "." not in filename:
                testit = filename + "/" + filename
                testpath = os.path.join(folder, testit + "Labels.tiff")
                if os.path.isfile(testpath):
                    candidates.append(testit)
                else:
                    print ("not found: ", testpath)
        self.candidate_prefixes = candidates
        assert len(candidates) > 1, (
            "Folder must have more than 1 candidate subfolder for comparison: " +
            repr((self.folder, candidates))
        )
        for prefix in [self.path_prefix2, self.path_prefix1]:
            if prefix is not None:
                assert prefix in candidates, (
                    "Argument prefix is not among the candidate folders: " +
                    repr((prefix, candidates))
                )
        return candidates

class SliceHolder:

    dummy_prefix = "(None)"

    def __init__(self, holder):
        self.holder = holder
        self.prefix = None
        self.loading = False
        self.loaded = False
        self.slice = None

    def make_widget(self):
        self.info = widgets.HTML("Select a slicing folder.")
        candidates = [self.dummy_prefix] + self.holder.candidate_prefixes
        self.dropdown = widgets.Dropdown(options=candidates)
        self.dropdown.observe(self.dropdown_change)
        self.slice_area = widgets.HBox(children=[self.info])
        ly = widgets.Layout(border='solid')
        self.container = widgets.VBox([
            self.dropdown,
            self.slice_area,
        ], layout=ly)
        return self.container

    def display_slice(self):
        pass

    def display_slice(self):
        slice_widget = self.slice.make_widget()


    def dropdown_change(self, change):
        if change['type'] != 'change' or change.get("name") != 'value':
            return
        new = self.dropdown.value
        if not self.loading:
            self.set_slicing(new)
            self.holder.check_slices()

    def set_slicing(self, prefix):
        self.info.value = "Loading: " + repr(prefix)
        try:
            self.loading = True
            self.loaded = False
            self.slice = None
            try:
                self.slice = TimeSlice(
                    folder=self.holder.folder,
                    path_prefix=prefix,
                    holder=self,
                )
            except AssertionError as e:
                self.info.value = repr(e)
                self.dropdown.value = self.dummy_prefix
                return None
            self.prefix = prefix
            self.dropdown.value = prefix
            self.info.value = repr(prefix) + " slice info loaded"
            self.loaded = True
            return self.slice
        finally:
            self.loading = False

    def reset(self):
        self.info.value = "Please select a new slicing folder."
        self.slice_area.children = [self.info]
        

def smoke_test():
    print ("this will only work on Aaron's machine right now.")
    slice = TimeSlice()
    slice.print_info()

if __name__ == "__main__":
    smoke_test()

