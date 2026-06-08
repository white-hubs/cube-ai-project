import { Injectable } from '@dangao/bun-server'
import { UnsupportedFormatParser } from './unsupported-format.parser'

@Injectable()
export class VideoParser extends UnsupportedFormatParser {
  public override readonly supportedExtensions = ['mp4']
  public override readonly supportedMimeTypes = ['video/mp4']
}
