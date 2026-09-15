'use client'

import { useEffect, useRef } from 'react'
import { Mesh, Program, Renderer, Triangle, Vec3 } from 'ogl'

import { isForegroundMotionActive } from '@/lib/foreground-motion'
import './orb.css'

type OrbProps = {
  hue?: number
  hoverIntensity?: number
  rotateOnHover?: boolean
  forceHoverState?: boolean
  backgroundColor?: string
  className?: string
}

function hexToVec3(color: string) {
  const value = color.replace('#', '')
  return new Vec3(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255)
}

/** React Bits Orb，作为面板内容区的动态视觉背景。 */
export function Orb({
  hue = 0,
  hoverIntensity = 0,
  rotateOnHover = true,
  forceHoverState = false,
  backgroundColor = '#000000',
  className = '',
}: OrbProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new Renderer({ alpha: true, premultipliedAlpha: false, dpr: Math.min(window.devicePixelRatio, 2) })
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    container.appendChild(gl.canvas)

    const vert = `precision highp float; attribute vec2 position; attribute vec2 uv; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.0,1.0);}`
    const frag = `precision highp float;
      uniform float iTime; uniform vec3 iResolution; uniform float hue; uniform float hover; uniform float rot;
      uniform float hoverIntensity; uniform vec3 backgroundColor; varying vec2 vUv;
      vec3 rgb2yiq(vec3 c){return vec3(dot(c,vec3(.299,.587,.114)),dot(c,vec3(.596,-.274,-.322)),dot(c,vec3(.211,-.523,.312)));}
      vec3 yiq2rgb(vec3 c){return vec3(c.x+.956*c.y+.621*c.z,c.x-.272*c.y-.647*c.z,c.x-1.106*c.y+1.703*c.z);}
      vec3 adjustHue(vec3 c,float d){float a=d*3.14159265/180.;vec3 y=rgb2yiq(c);float co=cos(a),si=sin(a);y.yz=vec2(y.y*co-y.z*si,y.y*si+y.z*co);return yiq2rgb(y);}
      vec3 hash33(vec3 p){p=fract(p*vec3(.1031,.11369,.13787));p+=dot(p,p.yxz+19.19);return -1.+2.*fract(vec3(p.x+p.y,p.x+p.z,p.y+p.z)*p.zyx);}
      float snoise3(vec3 p){const float K1=.333333333,K2=.166666667;vec3 i=floor(p+(p.x+p.y+p.z)*K1),d0=p-(i-(i.x+i.y+i.z)*K2),e=step(vec3(0.),d0-d0.yzx),i1=e*(1.-e.zxy),i2=1.-e.zxy*(1.-e),d1=d0-(i1-K2),d2=d0-(i2-K1),d3=d0-.5;vec4 h=max(.6-vec4(dot(d0,d0),dot(d1,d1),dot(d2,d2),dot(d3,d3)),0.);vec4 n=h*h*h*h*vec4(dot(d0,hash33(i)),dot(d1,hash33(i+i1)),dot(d2,hash33(i+i2)),dot(d3,hash33(i+1.)));return dot(vec4(31.316),n);}
      vec4 extractAlpha(vec3 c){float a=max(max(c.r,c.g),c.b);return vec4(c/(a+1e-5),a);}
      const vec3 c1=vec3(.611765,.262745,.996078),c2=vec3(.298039,.760784,.913725),c3=vec3(.062745,.078431,.6); const float inner=.6,scale=.65;
      float light1(float i,float a,float d){return i/(1.+d*a);} float light2(float i,float a,float d){return i/(1.+d*d*a);}
      vec4 draw(vec2 uv){vec3 color1=adjustHue(c1,hue),color2=adjustHue(c2,hue),color3=adjustHue(c3,hue);float ang=atan(uv.y,uv.x),len=length(uv),inv=len>0.?1./len:0.,lum=dot(backgroundColor,vec3(.299,.587,.114)),n=snoise3(vec3(uv*scale,iTime*.5))*.5+.5,r=mix(mix(inner,1.,.4),mix(inner,1.,.6),n),d0=distance(uv,(r*inv)*uv),v0=light1(1.,10.,d0);v0*=smoothstep(r*1.05,r,len)*mix(smoothstep(r*.8,r*.95,len),1.,lum*.7);float cl=cos(ang+iTime*2.)*.5+.5,a=iTime*-1.,d=distance(uv,vec2(cos(a),sin(a))*r),v1=light2(1.5,5.,d)*light1(1.,50.,d0),v2=smoothstep(1.,mix(inner,1.,n*.5),len),v3=smoothstep(inner,mix(inner,1.,.5),len);vec3 base=mix(color1,color2,cl),dark=clamp((mix(color3,base,v0)+v1)*v2*v3,0.,1.),light=clamp(mix(backgroundColor,(base+v1)*mix(1.,v2*v3,mix(1.,.1,lum)),v0),0.,1.);return extractAlpha(mix(dark,light,lum));}
      void main(){vec2 center=iResolution.xy*.5;float size=min(iResolution.x,iResolution.y);vec2 uv=(vUv*iResolution.xy-center)/size*2.;float s=sin(rot),c=cos(rot);uv=vec2(c*uv.x-s*uv.y,s*uv.x+c*uv.y);uv+=hover*hoverIntensity*.1*vec2(sin(uv.y*10.+iTime),sin(uv.x*10.+iTime));vec4 col=draw(uv);gl_FragColor=vec4(col.rgb*col.a,col.a);}`

    const uniforms = {
      iTime: { value: 0 }, iResolution: { value: new Vec3(1, 1, 1) }, hue: { value: hue }, hover: { value: 0 }, rot: { value: 0 },
      hoverIntensity: { value: hoverIntensity }, backgroundColor: { value: hexToVec3(backgroundColor) },
    }
    const program = new Program(gl, { vertex: vert, fragment: frag, uniforms })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })
    let targetHover = 0
    let currentRotation = 0
    let lastTime = 0
    const resize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      renderer.setSize(width, height)
      uniforms.iResolution.value.set(gl.canvas.width, gl.canvas.height, gl.canvas.width / Math.max(gl.canvas.height, 1))
    }
    const onMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const size = Math.min(rect.width, rect.height)
      const x = ((event.clientX - rect.left - rect.width / 2) / Math.max(size, 1)) * 2
      const y = ((event.clientY - rect.top - rect.height / 2) / Math.max(size, 1)) * 2
      targetHover = Math.hypot(x, y) < 0.8 ? 1 : 0
    }
    const onLeave = () => { targetHover = 0 }
    resize()
    window.addEventListener('resize', resize)
    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    let frame = 0
    let elapsed = 0
    const render = (time: number) => {
      frame = requestAnimationFrame(render)
      const dt = lastTime ? (time - lastTime) * 0.001 : 0
      lastTime = time
      // 前台过渡（卡片展开、抽屉滑入）播放期间不出帧：全幅画布每帧改写会迫使合成器重绘
      // 所有覆盖图层与 backdrop-filter，与过渡争抢帧预算。时钟一并暂停，恢复时画面不跳变。
      if (isForegroundMotionActive()) return
      elapsed += dt
      uniforms.iTime.value = elapsed
      const activeHover = forceHoverState ? 1 : targetHover
      uniforms.hover.value += (activeHover - uniforms.hover.value) * 0.1
      if (rotateOnHover && activeHover > 0.5) currentRotation += dt * 0.3
      uniforms.rot.value = currentRotation
      renderer.render({ scene: mesh })
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      if (container.contains(gl.canvas)) container.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [backgroundColor, forceHoverState, hue, hoverIntensity, rotateOnHover])

  return <div ref={containerRef} className={`orb-container ${className}`} aria-hidden="true" />
}
