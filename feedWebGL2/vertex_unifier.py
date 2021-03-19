"""
Utilities for combining very close vertices and eliminating degenerate triangles in meshes.
"""

import numpy as np

class Unifier:

    def __init__(self, triangles, resolution=10000, epsilon=1e-6):
        self.triangles = triangles
        self.resolution = resolution
        self.epsilon = epsilon
        self.resolution = resolution
        (ntriangles, three1, three2) = triangles.shape
        assert three1 == 3 and three2 == 3, "bad triangle set shape: " + repr(triangles.shape)
        self.ntriangles = ntriangles
        nvertices = self.ntriangles * 3
        vertices = self.vertices = triangles.reshape((nvertices, 3))
        vmax = vertices.max(axis=0)
        vmin = vertices.min(axis=0)
        # avoid zero division issues
        vmax = np.maximum(vmin + epsilon, vmax)
        diff = vmax - vmin
        #pr ("vertices")
        #pr (vertices)
        #pr ("vmin, vmax, diff", vmin, vmax, diff)
        shifted = self.vertices - vmin.reshape((1,3))
        scaled = resolution * shifted / diff.reshape((1,3))
        truncated = np.round(scaled).astype(np.int)
        #pr ("truncated")
        #pr (truncated)
        truncated_to_vertex = {}
        for i in range(nvertices):
            trunc = tuple(truncated[i])
            ##pr ("trunc", trunc)
            truncated_to_vertex[trunc] = vertices[i]
        #pr ("truncated to vertex")
        #pr (truncated_to_vertex)
        unification = list(truncated_to_vertex.keys())
        #truncated_to_index = {trunc: i for (i, trunc) in enumerate(unification)}
        n_output_vertices = len(unification)
        output_vertices = np.zeros((n_output_vertices, 3), dtype=np.float)
        truncated_to_output_index = {}
        for (i, trunc) in enumerate(unification):
            truncated_to_output_index[trunc] = i
            #index = truncated_to_index[trunc]
            #vert = vertices[index]
            ##pr("for index", index, "vertex", vert, "truncated", trunc)
            vert = truncated_to_vertex[trunc]
            output_vertices[i] = vert
        triangles = set()
        for tindex in range(0, nvertices, 3):
            #pr("triangle starting at", tindex)
            #pr (vertices[tindex: tindex+3])
            trunc0 = tuple(truncated[tindex])
            trunc1 = tuple(truncated[tindex + 1])
            trunc2 = tuple(truncated[tindex + 2])
            #pr ('truncated', trunc0, trunc1, trunc2)
            index0 = truncated_to_output_index[trunc0]
            index1 = truncated_to_output_index[trunc1]
            index2 = truncated_to_output_index[trunc2]
            #pr ("at indices", index0, index1, index2)
            triangle = (index0, index1, index2)
            # eliminate degenerates
            if len(set(triangle)) == 3:
                #pr ("   kept triangle", triangle)
                triangles.add(triangle)
        triangles_list = list(triangles)
        #return (output_vertices, triangles_list)
        self.output_vertices = output_vertices
        self.triangles_indices = np.array(triangles_list, dtype=np.int)

def test():
    # tetrahedron
    v0 = [1,1,1]
    v1 = [-1,-1,1]
    v2 = [1,-1,-1]
    v3 = [-1,1,-1]
    v3x = [-1,1,-1 + 1e-20]  # very close duplicate
    triangles = np.array([
        [v0, v1, v2],
        [v0, v2, v3],
        [v0, v1, v3x],
        [v1, v2, v3],
        [v1, v2, v3x],  # duplicate, close
        [v1, v2, v2],  # degenerate
    ], dtype=np.float)
    U = Unifier(triangles)
    vertices = U.output_vertices
    triangles = U.triangles_indices
    print ("vertices")
    print (vertices)
    print ("triangles")
    print (triangles)
    assert len(vertices) == 4
    assert len(triangles) == 4

if __name__ == "__main__":
    test()
