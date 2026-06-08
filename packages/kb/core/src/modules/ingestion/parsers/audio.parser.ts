import { Injectable } from '@dangao/bun-server'
import { UnsupportedFormatParser } from './unsupported-format.parser'

@Injectable()
export class AudioParser extends UnsupportedFormatParser {
  public override readonly supportedExtensions = ['mp3']
  public override readonly supportedMimeTypes = ['audio/mpeg']
}
