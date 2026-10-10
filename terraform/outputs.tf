output "vpc_ids" {
  description = "The IDs of the VPCs"
  value       = module.vpc.vpc_ids
}

output "public_subnet_ids" {
  description = "The IDs of the public subnets"
  value       = module.vpc.public_subnet_ids
}

output "instance_public_ip" {
  description = "The public IP of the EC2 instance"
  value       = aws_instance.example.public_ip
}

output "instance_id" {
  description = "The EC2 instance ID used by the dashboard"
  value       = aws_instance.example.id
}

output "aws_region" {
  description = "The AWS Region used by the dashboard"
  value       = var.aws_region
}

output "dashboard_policy_arn" {
  description = "Attach this policy to the IAM identity used by the dashboard"
  value       = aws_iam_policy.dashboard.arn
}

output "dashboard_env" {
  description = "Environment values for running the dashboard against the Terraform-managed instance"
  value       = <<-ENV
AWS_REGION=${var.aws_region}
AWS_PROFILE=${var.aws_profile}
EC2_INSTANCE_ID=${aws_instance.example.id}
EC2_SERIAL_PORT=0
BROWSER_SSH_TARGET=ubuntu@${aws_instance.example.public_ip}
BROWSER_SSH_KEY_PATH=${var.dashboard_ssh_key_path}
ENV
}

# ### S3 Bucket Outputs
# # {

# output "s3_bucket_id" {
#   description = "The ID of the S3 bucket"
#   value       = module.s3_bucket.bucket_id
# }

# output "s3_bucket_arn" {
#   description = "The ARN of the S3 bucket"
#   value       = module.s3_bucket.bucket_arn
# }

# # }
