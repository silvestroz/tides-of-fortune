// Bloom of the LINEAR HDR scene: three's UnrealBloomPass (bright pass at half size, five blurred mips down to 1/32,
// weighted sum of the mips at half size) without its last step. The stock pass blends the result over the scene
// with one more full-screen draw; here it stops at the half-size bloom texture and the grade pass adds it
// (src/post/gradePass.js). The bright pass reads the scene plus the sun shafts (src/post/godRaysPass.js), as it did
// when the shafts were composited before it.
// API: const bloom = new BloomPass(size, strength, radius, threshold); bloom.strength / radius / threshold;
//      bloom.enabled; bloom.setSize(w, h) (scene size); bloom.render(renderer, sceneTexture, raysTexture, raysGain);
//      bloom.texture (half-size result, already multiplied by strength); bloom.materials (programs to precompile).
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class BloomPass extends UnrealBloomPass {
  constructor(size, strength, radius, threshold) {
    super(size, strength, radius, threshold);
    const hp = this.materialHighPassFilter;
    hp.uniforms.tRays = { value: null };
    hp.uniforms.uRaysGain = { value: new THREE.Vector3() };
    // a single NaN/Inf pixel in the HDR scene (degenerate normal, 0/0 in a particle or wave term) was blurred by the
    // mip chain over the whole frame and composited back as NaN: an all-black 3D view (seen intermittently in the
    // combat showcases). Sanitise and clamp what enters the bloom.
    hp.fragmentShader = hp.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\n\t\tuniform sampler2D tRays;\n\t\tuniform vec3 uRaysGain;')
      .replace('vec4 texel = texture2D( tDiffuse, vUv );',
        'vec4 texel = vec4( texture2D( tDiffuse, vUv ).rgb + texture2D( tRays, vUv ).rgb * uRaysGain, 1.0 );\n\t\t\tif ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );\n\t\t\ttexel = min( texel, vec4( 64.0 ) );');
    hp.needsUpdate = true;
    this.texture = this.renderTargetsHorizontal[0].texture;
    this.materials = [hp, ...this.separableBlurMaterials, this.compositeMaterial];
  }

  render(renderer, sceneTexture, raysTexture, raysGain) {
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const quad = this._fsQuad, draw = (material, target) => {
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.clear();
      quad.render(renderer);
    };
    // bright areas of scene + shafts, at half size
    const hu = this.highPassUniforms;
    hu.tDiffuse.value = sceneTexture;
    hu.tRays.value = raysTexture;
    hu.uRaysGain.value.copy(raysGain);
    hu.luminosityThreshold.value = this.threshold;
    draw(this.materialHighPassFilter, this.renderTargetBright);
    // each mip: horizontal then vertical blur of the previous one
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i], u = m.uniforms;
      u.colorTexture.value = input.texture;
      u.direction.value = UnrealBloomPass.BlurDirectionX;
      draw(m, this.renderTargetsHorizontal[i]);
      u.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      u.direction.value = UnrealBloomPass.BlurDirectionY;
      draw(m, this.renderTargetsVertical[i]);
      input = this.renderTargetsVertical[i];
    }
    // weighted sum of the mips
    const cu = this.compositeMaterial.uniforms;
    cu.bloomStrength.value = this.strength;
    cu.bloomRadius.value = this.radius;
    cu.bloomTintColors.value = this.bloomTintColors;
    draw(this.compositeMaterial, this.renderTargetsHorizontal[0]);
    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}
