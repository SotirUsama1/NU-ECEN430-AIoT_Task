terraform {
    required_providers {
        aws = {
            source  = "hashicorp/aws"
            version = "~> 5.0"
        }
    }
}

provider "aws" {
    region = var.aws_region
    profile = var.aws_profile
    
    default_tags {
        tags = {
            Owner = var.owner_name
            Org   = var.org_name
            Project = var.project_name
            Env   = var.env_name
        }
    }
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
    state = "available"
}
