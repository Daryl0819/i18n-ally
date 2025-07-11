export enum ExtractionScore {
  MustInclude,
  ShouldInclude,
  None,
  ShouldExclude,
  MustExclude
}

export abstract class ExtractionRule {
  abstract name: string

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldExtract(str: string, attrName?: string): ExtractionScore | void {
    return ExtractionScore.None
  }
}
