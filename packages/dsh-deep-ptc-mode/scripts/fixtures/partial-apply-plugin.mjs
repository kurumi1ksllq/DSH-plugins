import z from '@deepseek-ai/schemastery';
export const inject=['tools'];
export const Config=z.object({fail:z.boolean().default(false)});
export function apply(ctx,config){ctx.tools.register({name:'partial_apply_probe',description:'Fixture',parameters:{type:'object'},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:()=> 'OK'});if(config.fail)throw new Error('fixture fails after registration');}
