

// var index = require('../dist/index');
import feedWebGL_is_loaded from "../dist/index";

describe('testing feedWebGL', () => {

    it('loads the feedWebGL index', () => {
        //expect(true).toEqual(true);
        expect(feedWebGL_is_loaded()).toBe(true);
    });

    it('creates a context', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        expect(context.gl).toBeTruthy();
    });

    it('allocates a buffer', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var buffer = context.buffer(null, 4);
        expect(buffer.name).toBeTruthy();
        expect(context.buffers[buffer.name]).toEqual(buffer);
    });

    it('creates a program', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        expect(program.gl_program).toBeNull();
        expect(context.programs[program.name]).toEqual(program);
    });

    it('compiles a program', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:true};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        expect(program.gl_program).toBeTruthy();
        expect(context.programs[program.name]).toEqual(program);
    });

    it('fails a compile', () => {
        var mockoptions = {fail_compile: true};
        mockCanvas(window, mockoptions);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        var compile_fn = (() => program.compile());
        expect(compile_fn).toThrow()
        var check_fn = (() => program.check_error());
        expect(check_fn).toThrow()
    });

    it('makes feedback variables', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 2},
            },
        };
        var program = context.program(options);
        var fA = program.feedbacks_by_name.feedback_A;
        var fB = program.feedbacks_by_name.feedback_B;
        expect(fA).toBeTruthy();
        expect(fB).toBeTruthy();
        expect(program.feedback_order[fA.index]).toEqual(fA);
        expect(fA.num_components).toEqual(3);
        expect(fB.bytes_per_component).toEqual(2);
        var fvs = program.feedback_variables();
        expect(fvs[fB.index]).toEqual("feedback_B");
    });

  });
