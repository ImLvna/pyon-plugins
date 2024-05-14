import { readFile, writeFile, readdir } from "fs/promises";
import { createHash } from "crypto";

import { rollup } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import swc from "@swc/core";

/** @type import("rollup").InputPluginOption */
const plugins = [
    nodeResolve(),
    commonjs(),
    {
        name: "swc",
        async transform(code, id) {
            const [, module, commonjs, type, xml] = id.match(/\.(m?)(c?)([tj]s)(x?)$/)
            if ((module || commonjs) && xml) return null; // .mtsx / .mjsx / .ctsx / .cjsx

            const result = await swc.transform(code, {
                filename: id,
                jsc: {
                    externalHelpers: true,
                    parser: {
                        syntax: type === "ts" ? "typescript" : "ecmascript",
                        tsx: Boolean(type === "ts" && xml),
                        jsx: Boolean(type === "js" && xml),
                    },
                },
                env: {
                    targets: "defaults",
                    include: [
                        "transform-classes",
                        "transform-arrow-functions",
                        "transform-block-scoping",
                        "transform-class-properties"
                    ],
                    exclude: [
                        "transform-parameters",
                        "transform-optional-chaining"
                    ]
                },
            });

            return result.code;
        },
    },
    esbuild({ minify: true }),
];

for (let plug of await readdir("./plugins")) {
    const manifest = JSON.parse(await readFile(`./plugins/${plug}/manifest.json`));
    const outPath = `./dist/${plug}/index.js`;

    try {
        const bundle = await rollup({
            input: `./plugins/${plug}/${manifest.main}`,
            onwarn: () => {},
            plugins,
        });
    
        await bundle.write({
            file: outPath,
            globals(id) {
                if (id.match(/^@(?:vendetta|bunny)/)) {
                    return id.substring(1).replace(/\//g, ".");
                }

                const map = {
                    react: "window.React",
                };

                return map[id] || null;
            },
            format: "iife",
            compact: true,
            exports: "named",
        });
        await bundle.close();
    
        const toHash = await readFile(outPath);
        manifest.hash = createHash("sha256").update(toHash).digest("hex");
        manifest.main = "index.js";
        await writeFile(`./dist/${plug}/manifest.json`, JSON.stringify(manifest));
    
        console.log(`Successfully built ${manifest.name}!`);
    } catch (e) {
        console.error("Failed to build plugin...", e);
        process.exit(1);
    }
}
